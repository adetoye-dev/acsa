// Copyright 2026 Achsah Systems
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

#![deny(warnings)]

use std::{
    collections::{HashMap, HashSet},
    env,
    path::Path,
    str::FromStr,
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock, RwLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use aes_gcm::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    QueryBuilder, Row, Sqlite, SqlitePool,
};
use thiserror::Error;
use uuid::Uuid;

use crate::observability::{HistogramBucket, HistogramSnapshot, MetricsSnapshot};

// NOTE: Managed credentials are process-global by design so non-storage modules (connectors,
// triggers, and nodes) can resolve secrets without holding a RunStore reference.
// This implies a single-process, single-active-store expectation: initialize one RunStore per
// process and avoid running multiple database-backed RunStore instances concurrently.
static MANAGED_CREDENTIALS: OnceLock<RwLock<HashMap<String, String>>> = OnceLock::new();
static PLAINTEXT_CREDENTIAL_MIGRATION_QUEUE: OnceLock<RwLock<HashSet<Option<String>>>> =
    OnceLock::new();
static PLAINTEXT_CREDENTIALS_SEEN_TOTAL: AtomicU64 = AtomicU64::new(0);
const CREDENTIAL_CIPHER_VERSION: &str = "enc:v1";
const CREDENTIAL_MASTER_KEY_ENV: &str = "ACSA_CREDENTIAL_MASTER_KEY";
const CREDENTIAL_STRICT_ENCRYPTION_ENV: &str = "ACSA_STRICT_CREDENTIAL_ENCRYPTION";

fn managed_credentials() -> &'static RwLock<HashMap<String, String>> {
    MANAGED_CREDENTIALS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn plaintext_credential_migration_queue() -> &'static RwLock<HashSet<Option<String>>> {
    PLAINTEXT_CREDENTIAL_MIGRATION_QUEUE.get_or_init(|| RwLock::new(HashSet::new()))
}

fn strict_credential_encryption_enabled() -> bool {
    matches!(
        env::var(CREDENTIAL_STRICT_ENCRYPTION_ENV).ok().as_deref().map(str::trim),
        Some("1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON")
    )
}

pub fn resolve_secret_value(name: &str) -> Option<String> {
    std::env::var(name).ok().or_else(|| match managed_credentials().read() {
        Ok(credentials) => credentials.get(name).cloned(),
        Err(poisoned) => {
            tracing::warn!(
                credential = %name,
                error = %poisoned,
                "managed_credentials read lock poisoned during resolve_secret_value; recovering lock"
            );
            let credentials = poisoned.into_inner();
            credentials.get(name).cloned()
        }
    })
}

#[derive(Debug, Clone)]
pub struct RunStore {
    pool: SqlitePool,
}

impl RunStore {
    pub async fn connect(path: impl AsRef<Path>) -> Result<Self, StorageError> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                tokio::fs::create_dir_all(parent).await?;
            }
        }

        let path_str = path
            .to_str()
            .ok_or_else(|| StorageError::InvalidPath(path.to_string_lossy().into_owned()))?;
        let database_url = format!("sqlite://{path_str}");
        let options = SqliteConnectOptions::from_str(&database_url)
            .map_err(|_| StorageError::InvalidConnectionUrl(database_url.clone()))?
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .foreign_keys(true);

        let pool = SqlitePoolOptions::new().max_connections(5).connect_with(options).await?;
        // Connect initializes the shared managed credential cache for this process. Multiple
        // RunStore instances against different databases in one process are not supported.
        let store = Self { pool };
        store.initialize().await?;
        store.refresh_managed_credentials_cache().await?;
        store.mark_incomplete_runs_failed().await?;
        Ok(store)
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn start_run(
        &self,
        workflow_name: &str,
        workflow_revision: &str,
        workflow_snapshot: &str,
        editor_snapshot: Option<&str>,
        initial_payload: &Value,
    ) -> Result<RunRecord, StorageError> {
        let record = RunRecord {
            id: Uuid::new_v4().to_string(),
            workflow_name: workflow_name.to_string(),
            status: RunStatus::Running.as_str().to_string(),
            started_at: current_timestamp(),
            finished_at: None,
            error_message: None,
            initial_payload: Some(serde_json::to_string(initial_payload)?),
            state_json: None,
            editor_snapshot: editor_snapshot.map(str::to_string),
            workflow_revision: Some(workflow_revision.to_string()),
            workflow_snapshot: Some(workflow_snapshot.to_string()),
        };

        sqlx::query(
            r#"
            INSERT INTO runs (
              id,
              workflow_name,
              status,
              started_at,
              finished_at,
              error_message,
              workflow_revision,
              editor_snapshot,
              workflow_snapshot,
              initial_payload,
              state_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&record.id)
        .bind(&record.workflow_name)
        .bind(&record.status)
        .bind(record.started_at)
        .bind(record.finished_at)
        .bind(&record.error_message)
        .bind(&record.workflow_revision)
        .bind(&record.editor_snapshot)
        .bind(&record.workflow_snapshot)
        .bind(&record.initial_payload)
        .bind(&record.state_json)
        .execute(&self.pool)
        .await?;

        Ok(record)
    }

    pub async fn get_run(&self, run_id: &str) -> Result<RunRecord, StorageError> {
        let row = sqlx::query(
            r#"
            SELECT id, workflow_name, status, started_at, finished_at, error_message, workflow_revision, editor_snapshot, workflow_snapshot, initial_payload, state_json
            FROM runs
            WHERE id = ?
            "#,
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::RunNotFound(run_id.to_string()))?;

        map_run_row(row)
    }

    pub async fn list_credentials(&self) -> Result<Vec<CredentialRecord>, StorageError> {
        let rows = sqlx::query(
            r#"
            SELECT name, updated_at
            FROM credentials
            ORDER BY name ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(CredentialRecord {
                    name: row.try_get("name")?,
                    updated_at: row.try_get("updated_at")?,
                })
            })
            .collect()
    }

    pub async fn upsert_credential(
        &self,
        name: &str,
        value: &str,
    ) -> Result<CredentialRecord, StorageError> {
        let name = name.trim();

        if name.is_empty() {
            return Err(StorageError::InvalidInput(
                "credential name must not be empty".to_string(),
            ));
        }

        let updated_at = current_timestamp();
        let encrypted_value = encrypt_value(value)?;
        sqlx::query(
            r#"
            INSERT INTO credentials (name, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(name) DO UPDATE
            SET value = excluded.value,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(name)
        .bind(encrypted_value)
        .bind(updated_at)
        .execute(&self.pool)
        .await?;

        match managed_credentials().write() {
            Ok(mut credentials) => {
                credentials.insert(name.to_string(), value.to_string());
            }
            Err(poisoned) => {
                tracing::warn!(
                    credential = %name,
                    error = %poisoned,
                    "managed_credentials write lock poisoned during upsert; recovering lock and updating cache. cache will be refreshed on next connect() call"
                );
                let mut credentials = poisoned.into_inner();
                credentials.insert(name.to_string(), value.to_string());
            }
        }

        match plaintext_credential_migration_queue().write() {
            Ok(mut queue) => {
                queue.remove(&Some(name.to_string()));
            }
            Err(poisoned) => {
                tracing::warn!(
                    credential = %name,
                    error = %poisoned,
                    "plaintext credential migration queue lock poisoned during upsert; recovering lock"
                );
                let mut queue = poisoned.into_inner();
                queue.remove(&Some(name.to_string()));
            }
        }

        Ok(CredentialRecord { name: name.to_string(), updated_at })
    }

    pub async fn delete_credential(&self, name: &str) -> Result<(), StorageError> {
        sqlx::query(
            r#"
            DELETE FROM credentials
            WHERE name = ?
            "#,
        )
        .bind(name)
        .execute(&self.pool)
        .await?;

        match managed_credentials().write() {
            Ok(mut credentials) => {
                credentials.remove(name);
            }
            Err(poisoned) => {
                tracing::warn!(
                    credential = %name,
                    error = %poisoned,
                    "managed_credentials write lock poisoned during delete; recovering lock and updating cache. cache will be refreshed on next connect() call"
                );
                let mut credentials = poisoned.into_inner();
                credentials.remove(name);
            }
        }

        match plaintext_credential_migration_queue().write() {
            Ok(mut queue) => {
                queue.remove(&Some(name.to_string()));
            }
            Err(poisoned) => {
                tracing::warn!(
                    credential = %name,
                    error = %poisoned,
                    "plaintext credential migration queue lock poisoned during delete; recovering lock"
                );
                let mut queue = poisoned.into_inner();
                queue.remove(&Some(name.to_string()));
            }
        }

        Ok(())
    }

    pub async fn list_workflows(&self) -> Result<Vec<WorkflowRecord>, StorageError> {
        let rows = sqlx::query(
            r#"
            SELECT id, name, yaml, created_at, updated_at
            FROM workflows
            ORDER BY updated_at DESC, created_at DESC, name ASC, id ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(map_workflow_row).collect()
    }

    pub async fn get_workflow(&self, workflow_id: &str) -> Result<WorkflowRecord, StorageError> {
        let row = sqlx::query(
            r#"
            SELECT id, name, yaml, created_at, updated_at
            FROM workflows
            WHERE id = ?
            "#,
        )
        .bind(workflow_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::WorkflowNotFound(workflow_id.to_string()))?;

        map_workflow_row(row)
    }

    pub async fn create_workflow(
        &self,
        workflow_id: &str,
        name: &str,
        yaml: &str,
    ) -> Result<WorkflowRecord, StorageError> {
        if workflow_id.trim().is_empty() {
            return Err(StorageError::InvalidInput("workflow id must not be empty".to_string()));
        }
        if name.trim().is_empty() {
            return Err(StorageError::InvalidInput("workflow name must not be empty".to_string()));
        }
        if yaml.trim().is_empty() {
            return Err(StorageError::InvalidInput("workflow yaml must not be empty".to_string()));
        }

        let now = current_timestamp();
        let result = sqlx::query(
            r#"
            INSERT INTO workflows (id, name, yaml, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(workflow_id)
        .bind(name)
        .bind(yaml)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await;

        match result {
            Ok(_) => self.get_workflow(workflow_id).await,
            Err(sqlx::Error::Database(database_error)) if database_error.is_unique_violation() => {
                Err(StorageError::WorkflowAlreadyExists(workflow_id.to_string()))
            }
            Err(error) => Err(StorageError::Sqlx(error)),
        }
    }

    pub async fn create_workflow_if_missing(
        &self,
        workflow_id: &str,
        name: &str,
        yaml: &str,
    ) -> Result<WorkflowRecord, StorageError> {
        let now = current_timestamp();
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO workflows (id, name, yaml, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(workflow_id)
        .bind(name)
        .bind(yaml)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;

        self.get_workflow(workflow_id).await
    }

    pub async fn update_workflow(
        &self,
        workflow_id: &str,
        name: &str,
        yaml: &str,
    ) -> Result<WorkflowRecord, StorageError> {
        let result = sqlx::query(
            r#"
            UPDATE workflows
            SET name = ?, yaml = ?, updated_at = ?
            WHERE id = ?
            "#,
        )
        .bind(name)
        .bind(yaml)
        .bind(current_timestamp())
        .bind(workflow_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(StorageError::WorkflowNotFound(workflow_id.to_string()));
        }

        self.get_workflow(workflow_id).await
    }

    pub async fn rename_workflow(
        &self,
        workflow_id: &str,
        target_id: &str,
        name: &str,
        yaml: &str,
    ) -> Result<WorkflowRecord, StorageError> {
        if workflow_id == target_id {
            return self.update_workflow(workflow_id, name, yaml).await;
        }

        let mut tx = self.pool.begin().await?;
        let existing = sqlx::query("SELECT id FROM workflows WHERE id = ?")
            .bind(target_id)
            .fetch_optional(&mut *tx)
            .await?;
        if existing.is_some() {
            return Err(StorageError::WorkflowAlreadyExists(target_id.to_string()));
        }

        let result = sqlx::query(
            r#"
            UPDATE workflows
            SET id = ?, name = ?, yaml = ?, updated_at = ?
            WHERE id = ?
            "#,
        )
        .bind(target_id)
        .bind(name)
        .bind(yaml)
        .bind(current_timestamp())
        .bind(workflow_id)
        .execute(&mut *tx)
        .await?;

        if result.rows_affected() == 0 {
            return Err(StorageError::WorkflowNotFound(workflow_id.to_string()));
        }

        tx.commit().await?;
        self.get_workflow(target_id).await
    }

    pub async fn delete_workflow(&self, workflow_id: &str) -> Result<(), StorageError> {
        let result = sqlx::query(
            r#"
            DELETE FROM workflows
            WHERE id = ?
            "#,
        )
        .bind(workflow_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(StorageError::WorkflowNotFound(workflow_id.to_string()));
        }

        Ok(())
    }

    pub async fn list_connector_records(&self) -> Result<Vec<ConnectorRecord>, StorageError> {
        let rows = sqlx::query(
            r#"
            SELECT
              id,
              type_name,
              name,
              runtime,
              source_kind,
              source_ref,
              connector_dir,
              manifest_path,
              manifest_json,
              created_at,
              updated_at
            FROM connector_records
            ORDER BY updated_at DESC, created_at DESC, name ASC, type_name ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(map_connector_record_row).collect()
    }

    pub async fn get_connector_record_by_type(
        &self,
        type_name: &str,
    ) -> Result<ConnectorRecord, StorageError> {
        let row = sqlx::query(
            r#"
            SELECT
              id,
              type_name,
              name,
              runtime,
              source_kind,
              source_ref,
              connector_dir,
              manifest_path,
              manifest_json,
              created_at,
              updated_at
            FROM connector_records
            WHERE type_name = ?
            "#,
        )
        .bind(type_name)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::ConnectorRecordNotFound(type_name.to_string()))?;

        map_connector_record_row(row)
    }

    pub async fn upsert_connector_record(
        &self,
        record: NewConnectorRecord<'_>,
    ) -> Result<ConnectorRecord, StorageError> {
        if record.type_name.trim().is_empty() {
            return Err(StorageError::InvalidInput(
                "connector type_name must not be empty".to_string(),
            ));
        }
        if record.name.trim().is_empty() {
            return Err(StorageError::InvalidInput("connector name must not be empty".to_string()));
        }
        if record.runtime.trim().is_empty() {
            return Err(StorageError::InvalidInput(
                "connector runtime must not be empty".to_string(),
            ));
        }
        if record.source_kind.trim().is_empty() {
            return Err(StorageError::InvalidInput(
                "connector source_kind must not be empty".to_string(),
            ));
        }
        if record.connector_dir.trim().is_empty() {
            return Err(StorageError::InvalidInput(
                "connector connector_dir must not be empty".to_string(),
            ));
        }
        if record.manifest_path.trim().is_empty() {
            return Err(StorageError::InvalidInput(
                "connector manifest_path must not be empty".to_string(),
            ));
        }
        if record.manifest_json.trim().is_empty() {
            return Err(StorageError::InvalidInput(
                "connector manifest_json must not be empty".to_string(),
            ));
        }

        let existing = sqlx::query(
            r#"
            SELECT id, created_at
            FROM connector_records
            WHERE type_name = ?
            "#,
        )
        .bind(record.type_name)
        .fetch_optional(&self.pool)
        .await?;

        let now = current_timestamp();
        let (id, created_at) = match existing {
            Some(row) => (row.try_get("id")?, row.try_get("created_at")?),
            None => (Uuid::new_v4().to_string(), now),
        };

        sqlx::query(
            r#"
            INSERT INTO connector_records (
              id,
              type_name,
              name,
              runtime,
              source_kind,
              source_ref,
              connector_dir,
              manifest_path,
              manifest_json,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(type_name) DO UPDATE
            SET name = excluded.name,
                runtime = excluded.runtime,
                source_kind = excluded.source_kind,
                source_ref = excluded.source_ref,
                connector_dir = excluded.connector_dir,
                manifest_path = excluded.manifest_path,
                manifest_json = excluded.manifest_json,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&id)
        .bind(record.type_name)
        .bind(record.name)
        .bind(record.runtime)
        .bind(record.source_kind)
        .bind(record.source_ref)
        .bind(record.connector_dir)
        .bind(record.manifest_path)
        .bind(record.manifest_json)
        .bind(created_at)
        .bind(now)
        .execute(&self.pool)
        .await?;

        self.get_connector_record_by_type(record.type_name).await
    }

    pub async fn list_node_records(&self) -> Result<Vec<NodeRecord>, StorageError> {
        let rows = sqlx::query(
            r#"
            SELECT
              id,
              type_name,
              label,
              description,
              category,
              source_kind,
              source_ref,
              created_at,
              updated_at
            FROM node_records
            ORDER BY updated_at DESC, created_at DESC, label ASC, type_name ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(map_node_record_row).collect()
    }

    pub async fn get_node_record_by_type(
        &self,
        type_name: &str,
    ) -> Result<NodeRecord, StorageError> {
        let row = sqlx::query(
            r#"
            SELECT
              id,
              type_name,
              label,
              description,
              category,
              source_kind,
              source_ref,
              created_at,
              updated_at
            FROM node_records
            WHERE type_name = ?
            "#,
        )
        .bind(type_name)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::NodeRecordNotFound(type_name.to_string()))?;

        map_node_record_row(row)
    }

    pub async fn upsert_node_record(
        &self,
        record: NewNodeRecord<'_>,
    ) -> Result<NodeRecord, StorageError> {
        if record.type_name.trim().is_empty() {
            return Err(StorageError::InvalidInput("node type_name must not be empty".to_string()));
        }
        if record.label.trim().is_empty() {
            return Err(StorageError::InvalidInput("node label must not be empty".to_string()));
        }
        if record.description.trim().is_empty() {
            return Err(StorageError::InvalidInput(
                "node description must not be empty".to_string(),
            ));
        }
        if record.category.trim().is_empty() {
            return Err(StorageError::InvalidInput("node category must not be empty".to_string()));
        }
        if record.source_kind.trim().is_empty() {
            return Err(StorageError::InvalidInput(
                "node source_kind must not be empty".to_string(),
            ));
        }

        let existing = sqlx::query(
            r#"
            SELECT id, created_at
            FROM node_records
            WHERE type_name = ?
            "#,
        )
        .bind(record.type_name)
        .fetch_optional(&self.pool)
        .await?;

        let now = current_timestamp();
        let (id, created_at) = match existing {
            Some(row) => (row.try_get("id")?, row.try_get("created_at")?),
            None => (Uuid::new_v4().to_string(), now),
        };

        sqlx::query(
            r#"
            INSERT INTO node_records (
              id,
              type_name,
              label,
              description,
              category,
              source_kind,
              source_ref,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(type_name) DO UPDATE
            SET label = excluded.label,
                description = excluded.description,
                category = excluded.category,
                source_kind = excluded.source_kind,
                source_ref = excluded.source_ref,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&id)
        .bind(record.type_name)
        .bind(record.label)
        .bind(record.description)
        .bind(record.category)
        .bind(record.source_kind)
        .bind(record.source_ref)
        .bind(created_at)
        .bind(now)
        .execute(&self.pool)
        .await?;

        self.get_node_record_by_type(record.type_name).await
    }

    pub fn queued_plaintext_credential_names(&self) -> Vec<String> {
        match plaintext_credential_migration_queue().read() {
            Ok(queue) => queue.iter().filter_map(Clone::clone).collect(),
            Err(poisoned) => {
                tracing::warn!(
                    error = %poisoned,
                    "plaintext credential migration queue lock poisoned during read; recovering lock"
                );
                poisoned.into_inner().iter().filter_map(Clone::clone).collect()
            }
        }
    }

    pub fn plaintext_credential_hits_total(&self) -> u64 {
        PLAINTEXT_CREDENTIALS_SEEN_TOTAL.load(Ordering::Relaxed)
    }

    pub async fn migrate_queued_plaintext_credentials(&self) -> Result<usize, StorageError> {
        let queued_names = self.queued_plaintext_credential_names();
        let mut migrated = 0usize;

        for name in queued_names {
            let value = match managed_credentials().read() {
                Ok(credentials) => credentials.get(&name).cloned(),
                Err(poisoned) => {
                    tracing::warn!(
                        credential = %name,
                        error = %poisoned,
                        "managed_credentials lock poisoned during plaintext credential migration read; recovering lock"
                    );
                    poisoned.into_inner().get(&name).cloned()
                }
            };

            let Some(value) = value else {
                continue;
            };

            self.upsert_credential(&name, &value).await?;
            migrated += 1;
        }

        Ok(migrated)
    }

    pub async fn complete_run_success(&self, run_id: &str) -> Result<(), StorageError> {
        let result = sqlx::query(
            r#"
            UPDATE runs
            SET status = ?, finished_at = ?, error_message = NULL, state_json = NULL
            WHERE id = ?
            "#,
        )
        .bind(RunStatus::Success.as_str())
        .bind(current_timestamp())
        .bind(run_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(StorageError::RunNotFound(run_id.to_string()));
        }

        Ok(())
    }

    pub async fn complete_run_failure(
        &self,
        run_id: &str,
        error_message: &str,
    ) -> Result<(), StorageError> {
        let result = sqlx::query(
            r#"
            UPDATE runs
            SET status = ?, finished_at = ?, error_message = ?, state_json = NULL
            WHERE id = ?
            "#,
        )
        .bind(RunStatus::Failed.as_str())
        .bind(current_timestamp())
        .bind(error_message)
        .bind(run_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(StorageError::RunNotFound(run_id.to_string()));
        }

        Ok(())
    }

    pub async fn pause_run(&self, run_id: &str, state_json: &str) -> Result<(), StorageError> {
        let result = sqlx::query(
            r#"
            UPDATE runs
            SET status = ?, finished_at = NULL, error_message = NULL, state_json = ?
            WHERE id = ?
            "#,
        )
        .bind(RunStatus::Paused.as_str())
        .bind(state_json)
        .bind(run_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(StorageError::RunNotFound(run_id.to_string()));
        }

        Ok(())
    }

    pub async fn mark_run_running(
        &self,
        run_id: &str,
        state_json: &str,
    ) -> Result<(), StorageError> {
        let result = sqlx::query(
            r#"
            UPDATE runs
            SET status = ?, finished_at = NULL, error_message = NULL, state_json = ?
            WHERE id = ?
            "#,
        )
        .bind(RunStatus::Running.as_str())
        .bind(state_json)
        .bind(run_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(StorageError::RunNotFound(run_id.to_string()));
        }

        Ok(())
    }

    pub async fn start_step_attempt(
        &self,
        run_id: &str,
        step_id: &str,
        attempt: u32,
        input: &Value,
    ) -> Result<StepRunRecord, StorageError> {
        let record = StepRunRecord {
            id: Uuid::new_v4().to_string(),
            run_id: run_id.to_string(),
            step_id: step_id.to_string(),
            status: RunStatus::Running.as_str().to_string(),
            started_at: current_timestamp(),
            finished_at: None,
            attempt,
            input: Some(serde_json::to_string(input)?),
            output: None,
            error_message: None,
        };

        sqlx::query(
            r#"
            INSERT INTO step_runs (id, run_id, step_id, status, started_at, finished_at, attempt, input, output, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&record.id)
        .bind(&record.run_id)
        .bind(&record.step_id)
        .bind(&record.status)
        .bind(record.started_at)
        .bind(record.finished_at)
        .bind(record.attempt)
        .bind(&record.input)
        .bind(&record.output)
        .bind(&record.error_message)
        .execute(&self.pool)
        .await?;

        Ok(record)
    }

    pub async fn complete_step_success(
        &self,
        step_run_id: &str,
        output: &Value,
    ) -> Result<(), StorageError> {
        sqlx::query(
            r#"
            UPDATE step_runs
            SET status = ?, finished_at = ?, output = ?, error_message = NULL
            WHERE id = ?
            "#,
        )
        .bind(RunStatus::Success.as_str())
        .bind(current_timestamp())
        .bind(serde_json::to_string(output)?)
        .bind(step_run_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn complete_step_failure(
        &self,
        step_run_id: &str,
        error_message: &str,
    ) -> Result<(), StorageError> {
        sqlx::query(
            r#"
            UPDATE step_runs
            SET status = ?, finished_at = ?, error_message = ?
            WHERE id = ?
            "#,
        )
        .bind(RunStatus::Failed.as_str())
        .bind(current_timestamp())
        .bind(error_message)
        .bind(step_run_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn complete_step_paused(
        &self,
        step_run_id: &str,
        pause_message: &str,
    ) -> Result<(), StorageError> {
        sqlx::query(
            r#"
            UPDATE step_runs
            SET status = ?, finished_at = NULL, error_message = ?
            WHERE id = ?
            "#,
        )
        .bind(RunStatus::Paused.as_str())
        .bind(pause_message)
        .bind(step_run_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn record_step_skipped(
        &self,
        run_id: &str,
        step_id: &str,
        input: &Value,
    ) -> Result<StepRunRecord, StorageError> {
        let timestamp = current_timestamp();
        let record = StepRunRecord {
            id: Uuid::new_v4().to_string(),
            run_id: run_id.to_string(),
            step_id: step_id.to_string(),
            status: RunStatus::Skipped.as_str().to_string(),
            started_at: timestamp,
            finished_at: Some(timestamp),
            attempt: 0,
            input: Some(serde_json::to_string(input)?),
            output: Some(serde_json::to_string(&Value::Null)?),
            error_message: None,
        };

        sqlx::query(
            r#"
            INSERT INTO step_runs (id, run_id, step_id, status, started_at, finished_at, attempt, input, output, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&record.id)
        .bind(&record.run_id)
        .bind(&record.step_id)
        .bind(&record.status)
        .bind(record.started_at)
        .bind(record.finished_at)
        .bind(record.attempt)
        .bind(&record.input)
        .bind(&record.output)
        .bind(&record.error_message)
        .execute(&self.pool)
        .await?;

        Ok(record)
    }

    pub async fn append_log(
        &self,
        run_id: Option<&str>,
        step_id: Option<&str>,
        level: &str,
        message: &str,
    ) -> Result<LogRecord, StorageError> {
        let record = LogRecord {
            id: Uuid::new_v4().to_string(),
            level: level.to_string(),
            message: message.to_string(),
            run_id: run_id.map(str::to_string),
            step_id: step_id.map(str::to_string),
            timestamp: current_timestamp(),
        };

        sqlx::query(
            r#"
            INSERT INTO logs (id, run_id, step_id, timestamp, level, message)
            VALUES (?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&record.id)
        .bind(&record.run_id)
        .bind(&record.step_id)
        .bind(record.timestamp)
        .bind(&record.level)
        .bind(&record.message)
        .execute(&self.pool)
        .await?;

        Ok(record)
    }

    pub async fn get_run_detail(
        &self,
        run_id: &str,
    ) -> Result<(RunRecord, Vec<StepRunRecord>, Vec<HumanTaskRecord>), StorageError> {
        let run = self.get_run(run_id).await?;
        let step_runs = self.list_step_runs(run_id).await?;
        let human_tasks = self.list_human_tasks_by_run(run_id).await?;
        Ok((run, step_runs, human_tasks))
    }

    pub async fn list_logs(
        &self,
        query: &LogQuery,
    ) -> Result<PaginatedResponse<LogRecord>, StorageError> {
        let total = count_logs(self, query).await?;
        let mut builder = QueryBuilder::<Sqlite>::new(
            "SELECT id, run_id, step_id, timestamp, level, message FROM logs WHERE 1 = 1",
        );
        apply_log_filters(&mut builder, query);
        builder.push(" ORDER BY timestamp DESC LIMIT ");
        builder.push_bind(query.limit.max(1) as i64);
        builder.push(" OFFSET ");
        builder.push_bind(query.offset as i64);

        let rows = builder.build().fetch_all(&self.pool).await?;
        Ok(PaginatedResponse {
            items: rows.into_iter().map(map_log_row).collect::<Result<Vec<_>, _>>()?,
            total,
        })
    }

    pub async fn list_runs(&self) -> Result<Vec<RunRecord>, StorageError> {
        Ok(self.list_runs_page(&RunQuery { limit: 10_000, ..RunQuery::default() }).await?.items)
    }

    pub async fn latest_runs_for_workflows(
        &self,
        workflow_names: &[String],
    ) -> Result<Vec<RunRecord>, StorageError> {
        if workflow_names.is_empty() {
            return Ok(Vec::new());
        }

        let mut builder = QueryBuilder::<Sqlite>::new(
            "SELECT id, workflow_name, status, started_at, finished_at, error_message, workflow_revision, editor_snapshot, workflow_snapshot, initial_payload, state_json FROM (SELECT id, workflow_name, status, started_at, finished_at, error_message, workflow_revision, editor_snapshot, workflow_snapshot, initial_payload, state_json, ROW_NUMBER() OVER (PARTITION BY workflow_name ORDER BY started_at DESC, COALESCE(finished_at, started_at) DESC, workflow_snapshot IS NOT NULL DESC, editor_snapshot IS NOT NULL DESC, state_json IS NOT NULL DESC, id DESC) AS row_number FROM runs WHERE workflow_name IN (",
        );
        {
            let mut separated = builder.separated(", ");
            for workflow_name in workflow_names {
                separated.push_bind(workflow_name);
            }
        }
        builder.push(")) WHERE row_number = 1 ORDER BY workflow_name ASC");

        let rows = builder.build().fetch_all(&self.pool).await?;
        rows.into_iter().map(map_run_row).collect()
    }

    pub async fn list_runs_page(
        &self,
        query: &RunQuery,
    ) -> Result<PaginatedResponse<RunRecord>, StorageError> {
        let total = count_runs(self, query).await?;
        let mut builder = QueryBuilder::<Sqlite>::new(
            "SELECT id, workflow_name, status, started_at, finished_at, error_message, workflow_revision, editor_snapshot, workflow_snapshot, initial_payload, state_json FROM runs WHERE 1 = 1",
        );
        apply_run_filters(&mut builder, query);
        builder.push(" ORDER BY started_at DESC LIMIT ");
        builder.push_bind(query.limit.max(1) as i64);
        builder.push(" OFFSET ");
        builder.push_bind(query.offset as i64);

        let rows = builder.build().fetch_all(&self.pool).await?;
        Ok(PaginatedResponse {
            items: rows.into_iter().map(map_run_row).collect::<Result<Vec<_>, _>>()?,
            total,
        })
    }

    pub async fn list_step_runs(&self, run_id: &str) -> Result<Vec<StepRunRecord>, StorageError> {
        let rows = sqlx::query(
            r#"
            SELECT id, run_id, step_id, status, started_at, finished_at, attempt, input, output, error_message
            FROM step_runs
            WHERE run_id = ?
            ORDER BY started_at ASC, attempt ASC
            "#,
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(map_step_run_row).collect()
    }

    pub async fn list_human_tasks_by_run(
        &self,
        run_id: &str,
    ) -> Result<Vec<HumanTaskRecord>, StorageError> {
        let rows = sqlx::query(
            r#"
            SELECT id, run_id, step_run_id, step_id, kind, status, prompt, field, details, response, created_at, completed_at
            FROM human_tasks
            WHERE run_id = ?
            ORDER BY created_at ASC
            "#,
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(map_human_task_row).collect()
    }

    pub async fn create_human_task(
        &self,
        task: NewHumanTask<'_>,
    ) -> Result<HumanTaskRecord, StorageError> {
        let record = HumanTaskRecord {
            id: Uuid::new_v4().to_string(),
            run_id: task.run_id.to_string(),
            step_run_id: task.step_run_id.to_string(),
            step_id: task.step_id.to_string(),
            kind: task.kind.to_string(),
            status: HumanTaskStatus::Pending.as_str().to_string(),
            prompt: task.prompt.to_string(),
            field: task.field.map(str::to_string),
            details: Some(serde_json::to_string(task.details)?),
            response: None,
            created_at: current_timestamp(),
            completed_at: None,
        };

        sqlx::query(
            r#"
            INSERT INTO human_tasks (
              id, run_id, step_run_id, step_id, kind, status, prompt, field, details, response, created_at, completed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&record.id)
        .bind(&record.run_id)
        .bind(&record.step_run_id)
        .bind(&record.step_id)
        .bind(&record.kind)
        .bind(&record.status)
        .bind(&record.prompt)
        .bind(&record.field)
        .bind(&record.details)
        .bind(&record.response)
        .bind(record.created_at)
        .bind(record.completed_at)
        .execute(&self.pool)
        .await?;

        Ok(record)
    }

    pub async fn get_human_task(&self, task_id: &str) -> Result<HumanTaskRecord, StorageError> {
        let row = sqlx::query(
            r#"
            SELECT id, run_id, step_run_id, step_id, kind, status, prompt, field, details, response, created_at, completed_at
            FROM human_tasks
            WHERE id = ?
            "#,
        )
        .bind(task_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::HumanTaskNotFound(task_id.to_string()))?;

        map_human_task_row(row)
    }

    pub async fn list_pending_human_tasks(&self) -> Result<Vec<HumanTaskRecord>, StorageError> {
        let rows = sqlx::query(
            r#"
            SELECT id, run_id, step_run_id, step_id, kind, status, prompt, field, details, response, created_at, completed_at
            FROM human_tasks
            WHERE status = ?
            ORDER BY created_at ASC
            "#,
        )
        .bind(HumanTaskStatus::Pending.as_str())
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(map_human_task_row).collect()
    }

    pub async fn resolve_human_task(
        &self,
        task_id: &str,
        response: &Value,
    ) -> Result<(), StorageError> {
        let result = sqlx::query(
            r#"
            UPDATE human_tasks
            SET status = ?, response = ?, completed_at = ?
            WHERE id = ? AND status = ?
            "#,
        )
        .bind(HumanTaskStatus::Resolved.as_str())
        .bind(serde_json::to_string(response)?)
        .bind(current_timestamp())
        .bind(task_id)
        .bind(HumanTaskStatus::Pending.as_str())
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(StorageError::HumanTaskNotFound(task_id.to_string()));
        }

        Ok(())
    }

    pub async fn upsert_trigger_state(
        &self,
        workflow_name: &str,
        trigger_type: &str,
        next_run_at: Option<i64>,
    ) -> Result<(), StorageError> {
        sqlx::query(
            r#"
            INSERT INTO trigger_state (workflow_name, trigger_type, next_run_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(workflow_name) DO UPDATE SET
              trigger_type = excluded.trigger_type,
              next_run_at = excluded.next_run_at,
              updated_at = excluded.updated_at
            "#,
        )
        .bind(workflow_name)
        .bind(trigger_type)
        .bind(next_run_at)
        .bind(current_timestamp())
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn metrics_snapshot(&self) -> Result<MetricsSnapshot, StorageError> {
        let status_rows =
            sqlx::query(r#"SELECT status, COUNT(*) AS count FROM runs GROUP BY status"#)
                .fetch_all(&self.pool)
                .await?;
        let mut snapshot = MetricsSnapshot::default();
        for row in status_rows {
            let status = row.try_get::<String, _>("status")?;
            let count = row.try_get::<i64, _>("count")? as u64;
            snapshot.workflow_runs_total += count;
            match status.as_str() {
                "failed" => snapshot.workflow_runs_failed_total = count,
                "paused" => snapshot.workflow_runs_paused_total = count,
                "running" => snapshot.workflow_runs_running_total = count,
                "success" => snapshot.workflow_runs_success_total = count,
                _ => {}
            }
        }

        let step_status_rows =
            sqlx::query(r#"SELECT status, COUNT(*) AS count FROM step_runs GROUP BY status"#)
                .fetch_all(&self.pool)
                .await?;
        for row in step_status_rows {
            let status = row.try_get::<String, _>("status")?;
            let count = row.try_get::<i64, _>("count")? as u64;
            if status != "skipped" {
                snapshot.step_executions_total += count;
            }
            if status == "failed" {
                snapshot.step_failures_total = count;
            }
        }

        let retry_row = sqlx::query(r#"SELECT COUNT(*) AS count FROM step_runs WHERE attempt > 1"#)
            .fetch_one(&self.pool)
            .await?;
        snapshot.step_retries_total = retry_row.try_get::<i64, _>("count")? as u64;

        let run_metrics = sqlx::query(
            r#"
            SELECT
                COUNT(*) AS count,
                AVG(finished_at - started_at) AS avg_duration,
                SUM(CASE WHEN (finished_at - started_at) < 1 THEN 1 ELSE 0 END) AS bucket_0_1s,
                SUM(CASE WHEN (finished_at - started_at) >= 1 AND (finished_at - started_at) < 5 THEN 1 ELSE 0 END) AS bucket_1_5s,
                SUM(CASE WHEN (finished_at - started_at) >= 5 AND (finished_at - started_at) < 10 THEN 1 ELSE 0 END) AS bucket_5_10s,
                SUM(CASE WHEN (finished_at - started_at) >= 10 AND (finished_at - started_at) < 30 THEN 1 ELSE 0 END) AS bucket_10_30s,
                SUM(CASE WHEN (finished_at - started_at) >= 30 AND (finished_at - started_at) < 60 THEN 1 ELSE 0 END) AS bucket_30_60s,
                SUM(CASE WHEN (finished_at - started_at) >= 60 THEN 1 ELSE 0 END) AS bucket_60s_plus
            FROM runs
            WHERE finished_at IS NOT NULL
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        let step_metrics = sqlx::query(
            r#"
            SELECT
                COUNT(*) AS count,
                AVG(finished_at - started_at) AS avg_duration,
                SUM(CASE WHEN (finished_at - started_at) < 1 THEN 1 ELSE 0 END) AS bucket_0_1s,
                SUM(CASE WHEN (finished_at - started_at) >= 1 AND (finished_at - started_at) < 2 THEN 1 ELSE 0 END) AS bucket_1_2s,
                SUM(CASE WHEN (finished_at - started_at) >= 2 AND (finished_at - started_at) < 5 THEN 1 ELSE 0 END) AS bucket_2_5s,
                SUM(CASE WHEN (finished_at - started_at) >= 5 AND (finished_at - started_at) < 10 THEN 1 ELSE 0 END) AS bucket_5_10s,
                SUM(CASE WHEN (finished_at - started_at) >= 10 THEN 1 ELSE 0 END) AS bucket_10s_plus
            FROM step_runs
            WHERE finished_at IS NOT NULL
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        if let Ok(avg) = run_metrics.try_get::<Option<f64>, _>("avg_duration") {
            snapshot.workflow_average_duration_seconds = avg.unwrap_or(0.0);
        }

        let run_buckets = vec![
            HistogramBucket {
                le: 1.0,
                count: run_metrics.try_get::<i64, _>("bucket_0_1s").unwrap_or(0) as u64,
            },
            HistogramBucket {
                le: 5.0,
                count: (run_metrics.try_get::<i64, _>("bucket_0_1s").unwrap_or(0)
                    + run_metrics.try_get::<i64, _>("bucket_1_5s").unwrap_or(0))
                    as u64,
            },
            HistogramBucket {
                le: 10.0,
                count: (run_metrics.try_get::<i64, _>("bucket_0_1s").unwrap_or(0)
                    + run_metrics.try_get::<i64, _>("bucket_1_5s").unwrap_or(0)
                    + run_metrics.try_get::<i64, _>("bucket_5_10s").unwrap_or(0))
                    as u64,
            },
            HistogramBucket {
                le: 30.0,
                count: (run_metrics.try_get::<i64, _>("bucket_0_1s").unwrap_or(0)
                    + run_metrics.try_get::<i64, _>("bucket_1_5s").unwrap_or(0)
                    + run_metrics.try_get::<i64, _>("bucket_5_10s").unwrap_or(0)
                    + run_metrics.try_get::<i64, _>("bucket_10_30s").unwrap_or(0))
                    as u64,
            },
            HistogramBucket {
                le: 60.0,
                count: (run_metrics.try_get::<i64, _>("bucket_0_1s").unwrap_or(0)
                    + run_metrics.try_get::<i64, _>("bucket_1_5s").unwrap_or(0)
                    + run_metrics.try_get::<i64, _>("bucket_5_10s").unwrap_or(0)
                    + run_metrics.try_get::<i64, _>("bucket_10_30s").unwrap_or(0)
                    + run_metrics.try_get::<i64, _>("bucket_30_60s").unwrap_or(0))
                    as u64,
            },
            HistogramBucket {
                le: f64::INFINITY,
                count: run_metrics.try_get::<i64, _>("count").unwrap_or(0) as u64,
            },
        ];
        let run_sum =
            run_metrics.try_get::<Option<f64>, _>("avg_duration").unwrap_or(None).unwrap_or(0.0)
                * (run_metrics.try_get::<i64, _>("count").unwrap_or(0) as f64);
        snapshot.workflow_duration_histogram = HistogramSnapshot {
            buckets: run_buckets,
            count: run_metrics.try_get::<i64, _>("count").unwrap_or(0) as u64,
            sum: run_sum,
        };

        let step_buckets = vec![
            HistogramBucket {
                le: 1.0,
                count: step_metrics.try_get::<i64, _>("bucket_0_1s").unwrap_or(0) as u64,
            },
            HistogramBucket {
                le: 2.0,
                count: (step_metrics.try_get::<i64, _>("bucket_0_1s").unwrap_or(0)
                    + step_metrics.try_get::<i64, _>("bucket_1_2s").unwrap_or(0))
                    as u64,
            },
            HistogramBucket {
                le: 5.0,
                count: (step_metrics.try_get::<i64, _>("bucket_0_1s").unwrap_or(0)
                    + step_metrics.try_get::<i64, _>("bucket_1_2s").unwrap_or(0)
                    + step_metrics.try_get::<i64, _>("bucket_2_5s").unwrap_or(0))
                    as u64,
            },
            HistogramBucket {
                le: 10.0,
                count: (step_metrics.try_get::<i64, _>("bucket_0_1s").unwrap_or(0)
                    + step_metrics.try_get::<i64, _>("bucket_1_2s").unwrap_or(0)
                    + step_metrics.try_get::<i64, _>("bucket_2_5s").unwrap_or(0)
                    + step_metrics.try_get::<i64, _>("bucket_5_10s").unwrap_or(0))
                    as u64,
            },
            HistogramBucket {
                le: f64::INFINITY,
                count: step_metrics.try_get::<i64, _>("count").unwrap_or(0) as u64,
            },
        ];
        let step_sum =
            step_metrics.try_get::<Option<f64>, _>("avg_duration").unwrap_or(None).unwrap_or(0.0)
                * (step_metrics.try_get::<i64, _>("count").unwrap_or(0) as f64);
        snapshot.step_duration_histogram = HistogramSnapshot {
            buckets: step_buckets,
            count: step_metrics.try_get::<i64, _>("count").unwrap_or(0) as u64,
            sum: step_sum,
        };

        Ok(snapshot)
    }

    pub async fn purge_history(
        &self,
        run_finished_before: Option<i64>,
        log_before: Option<i64>,
    ) -> Result<PurgeSummary, StorageError> {
        let mut summary = PurgeSummary::default();
        let mut tx = self.pool.begin().await?;

        if let Some(run_finished_before) = run_finished_before {
            let rows = sqlx::query(
                r#"
                SELECT id
                FROM runs
                WHERE finished_at IS NOT NULL
                  AND finished_at < ?
                  AND status != ?
                "#,
            )
            .bind(run_finished_before)
            .bind(RunStatus::Running.as_str())
            .fetch_all(&mut *tx)
            .await?;

            let run_ids: Vec<String> =
                rows.into_iter().filter_map(|row| row.try_get::<String, _>("id").ok()).collect();

            if !run_ids.is_empty() {
                const BATCH_SIZE: usize = 500;
                for chunk in run_ids.chunks(BATCH_SIZE) {
                    let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");

                    let log_sql = format!("DELETE FROM logs WHERE run_id IN ({})", placeholders);
                    let mut log_query = sqlx::query(&log_sql);
                    for id in chunk {
                        log_query = log_query.bind(id);
                    }
                    summary.purged_logs += log_query.execute(&mut *tx).await?.rows_affected();

                    let task_sql =
                        format!("DELETE FROM human_tasks WHERE run_id IN ({})", placeholders);
                    let mut task_query = sqlx::query(&task_sql);
                    for id in chunk {
                        task_query = task_query.bind(id);
                    }
                    task_query.execute(&mut *tx).await?;

                    let step_sql =
                        format!("DELETE FROM step_runs WHERE run_id IN ({})", placeholders);
                    let mut step_query = sqlx::query(&step_sql);
                    for id in chunk {
                        step_query = step_query.bind(id);
                    }
                    step_query.execute(&mut *tx).await?;

                    let run_sql = format!("DELETE FROM runs WHERE id IN ({})", placeholders);
                    let mut run_query = sqlx::query(&run_sql);
                    for id in chunk {
                        run_query = run_query.bind(id);
                    }
                    summary.purged_runs += run_query.execute(&mut *tx).await?.rows_affected();
                }
            }
        }

        if let Some(log_before) = log_before {
            summary.purged_logs += sqlx::query("DELETE FROM logs WHERE timestamp < ?")
                .bind(log_before)
                .execute(&mut *tx)
                .await?
                .rows_affected();
        }

        tx.commit().await?;
        Ok(summary)
    }

    async fn initialize(&self) -> Result<(), StorageError> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS runs (
              id TEXT PRIMARY KEY,
              workflow_name TEXT NOT NULL,
              status TEXT NOT NULL,
              started_at INTEGER NOT NULL,
              finished_at INTEGER,
              error_message TEXT,
              workflow_revision TEXT,
              editor_snapshot TEXT,
              workflow_snapshot TEXT,
              initial_payload TEXT,
              state_json TEXT
            )
            "#,
        )
        .execute(&self.pool)
        .await?;
        self.ensure_column("runs", "workflow_revision", "TEXT").await?;
        self.ensure_column("runs", "editor_snapshot", "TEXT").await?;
        self.ensure_column("runs", "workflow_snapshot", "TEXT").await?;
        self.ensure_column("runs", "initial_payload", "TEXT").await?;
        self.ensure_column("runs", "state_json", "TEXT").await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS workflows (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              yaml TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS credentials (
              name TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at INTEGER NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS connector_records (
              id TEXT PRIMARY KEY,
              type_name TEXT NOT NULL UNIQUE,
              name TEXT NOT NULL,
              runtime TEXT NOT NULL,
              source_kind TEXT NOT NULL,
              source_ref TEXT,
              connector_dir TEXT NOT NULL,
              manifest_path TEXT NOT NULL,
              manifest_json TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS node_records (
              id TEXT PRIMARY KEY,
              type_name TEXT NOT NULL UNIQUE,
              label TEXT NOT NULL,
              description TEXT NOT NULL,
              category TEXT NOT NULL,
              source_kind TEXT NOT NULL,
              source_ref TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS step_runs (
              id TEXT PRIMARY KEY,
              run_id TEXT NOT NULL,
              step_id TEXT NOT NULL,
              status TEXT NOT NULL,
              started_at INTEGER NOT NULL,
              finished_at INTEGER,
              attempt INTEGER NOT NULL,
              input TEXT,
              output TEXT,
              error_message TEXT,
              FOREIGN KEY(run_id) REFERENCES runs(id)
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS human_tasks (
              id TEXT PRIMARY KEY,
              run_id TEXT NOT NULL,
              step_run_id TEXT NOT NULL,
              step_id TEXT NOT NULL,
              kind TEXT NOT NULL,
              status TEXT NOT NULL,
              prompt TEXT NOT NULL,
              field TEXT,
              details TEXT,
              response TEXT,
              created_at INTEGER NOT NULL,
              completed_at INTEGER,
              FOREIGN KEY(run_id) REFERENCES runs(id),
              FOREIGN KEY(step_run_id) REFERENCES step_runs(id)
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS logs (
              id TEXT PRIMARY KEY,
              run_id TEXT,
              step_id TEXT,
              timestamp INTEGER NOT NULL,
              level TEXT NOT NULL,
              message TEXT NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS trigger_state (
              workflow_name TEXT PRIMARY KEY,
              trigger_type TEXT NOT NULL,
              next_run_at INTEGER,
              updated_at INTEGER NOT NULL
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_runs_workflow_name ON runs(workflow_name)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_workflows_updated_at ON workflows(updated_at)")
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_connector_records_updated_at ON connector_records(updated_at)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_node_records_updated_at ON node_records(updated_at)",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_step_runs_run_id ON step_runs(run_id)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_human_tasks_run_id ON human_tasks(run_id)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_human_tasks_status ON human_tasks(status)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_logs_run_id ON logs(run_id)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_trigger_state_next_run_at ON trigger_state(next_run_at)")
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    async fn mark_incomplete_runs_failed(&self) -> Result<(), StorageError> {
        let restart_message = "engine restarted before run completion";

        sqlx::query(
            r#"
            UPDATE runs
            SET status = ?, finished_at = ?, error_message = ?
            WHERE status = ?
            "#,
        )
        .bind(RunStatus::Failed.as_str())
        .bind(current_timestamp())
        .bind(restart_message)
        .bind(RunStatus::Running.as_str())
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            UPDATE step_runs
            SET status = ?, finished_at = ?, error_message = ?
            WHERE status = ?
            "#,
        )
        .bind(RunStatus::Failed.as_str())
        .bind(current_timestamp())
        .bind(restart_message)
        .bind(RunStatus::Running.as_str())
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn ensure_column(
        &self,
        table: &str,
        column: &str,
        definition: &str,
    ) -> Result<(), StorageError> {
        let rows =
            sqlx::query(&format!("PRAGMA table_info({table})")).fetch_all(&self.pool).await?;
        let exists = rows.iter().any(|row| {
            row.try_get::<String, _>("name").map(|name| name == column).unwrap_or(false)
        });
        if exists {
            return Ok(());
        }

        sqlx::query(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn refresh_managed_credentials_cache(&self) -> Result<(), StorageError> {
        let rows = sqlx::query(
            r#"
            SELECT name, value
            FROM credentials
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut next_credentials = HashMap::new();
        for row in rows {
            let name: String = row.try_get("name")?;
            let encrypted_value: String = row.try_get("value")?;
            let value = decrypt_value(&encrypted_value, Some(&name))?;
            next_credentials.insert(name, value);
        }

        match managed_credentials().write() {
            Ok(mut credentials) => {
                *credentials = next_credentials;
            }
            Err(error) => {
                tracing::error!(
                    error = %error,
                    "failed to acquire managed_credentials write lock in refresh_managed_credentials_cache"
                );
                return Err(StorageError::DataIntegrity(
                    "failed to acquire managed_credentials write lock in refresh_managed_credentials_cache"
                        .to_string(),
                ));
            }
        }

        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunRecord {
    pub id: String,
    pub workflow_name: String,
    pub status: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub error_message: Option<String>,
    pub workflow_revision: Option<String>,
    pub editor_snapshot: Option<String>,
    pub workflow_snapshot: Option<String>,
    pub initial_payload: Option<String>,
    pub state_json: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StepRunRecord {
    pub id: String,
    pub run_id: String,
    pub step_id: String,
    pub status: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub attempt: u32,
    pub input: Option<String>,
    pub output: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LogRecord {
    pub id: String,
    pub run_id: Option<String>,
    pub step_id: Option<String>,
    pub timestamp: i64,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CredentialRecord {
    pub name: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkflowRecord {
    pub id: String,
    pub name: String,
    pub yaml: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectorRecord {
    pub id: String,
    pub type_name: String,
    pub name: String,
    pub runtime: String,
    pub source_kind: String,
    pub source_ref: Option<String>,
    pub connector_dir: String,
    pub manifest_path: String,
    pub manifest_json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NodeRecord {
    pub id: String,
    pub type_name: String,
    pub label: String,
    pub description: String,
    pub category: String,
    pub source_kind: String,
    pub source_ref: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HumanTaskRecord {
    pub id: String,
    pub run_id: String,
    pub step_run_id: String,
    pub step_id: String,
    pub kind: String,
    pub status: String,
    pub prompt: String,
    pub field: Option<String>,
    pub details: Option<String>,
    pub response: Option<String>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Clone, Copy)]
pub struct NewHumanTask<'a> {
    pub details: &'a Value,
    pub field: Option<&'a str>,
    pub kind: &'a str,
    pub prompt: &'a str,
    pub run_id: &'a str,
    pub step_id: &'a str,
    pub step_run_id: &'a str,
}

#[derive(Debug, Clone, Copy)]
pub struct NewConnectorRecord<'a> {
    pub type_name: &'a str,
    pub name: &'a str,
    pub runtime: &'a str,
    pub source_kind: &'a str,
    pub source_ref: Option<&'a str>,
    pub connector_dir: &'a str,
    pub manifest_path: &'a str,
    pub manifest_json: &'a str,
}

#[derive(Debug, Clone, Copy)]
pub struct NewNodeRecord<'a> {
    pub type_name: &'a str,
    pub label: &'a str,
    pub description: &'a str,
    pub category: &'a str,
    pub source_kind: &'a str,
    pub source_ref: Option<&'a str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunStatus {
    Failed,
    Paused,
    Running,
    Skipped,
    Success,
}

impl RunStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Failed => "failed",
            Self::Paused => "paused",
            Self::Running => "running",
            Self::Skipped => "skipped",
            Self::Success => "success",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HumanTaskStatus {
    Cancelled,
    Pending,
    Resolved,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LogQuery {
    pub level: Option<String>,
    pub limit: usize,
    pub offset: usize,
    pub run_id: Option<String>,
    pub search: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RunQuery {
    pub limit: usize,
    pub offset: usize,
    pub started_after: Option<i64>,
    pub started_before: Option<i64>,
    pub status: Option<String>,
    pub workflow_name: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PaginatedResponse<T> {
    pub items: Vec<T>,
    pub total: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PurgeSummary {
    pub purged_logs: u64,
    pub purged_runs: u64,
}

impl HumanTaskStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Cancelled => "cancelled",
            Self::Pending => "pending",
            Self::Resolved => "resolved",
        }
    }
}

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("failed to prepare sqlite storage at {path}: {source}")]
    InvalidDatabasePath {
        path: String,
        #[source]
        source: sqlx::Error,
    },
    #[error("database operation failed: {0}")]
    Sqlx(#[from] sqlx::Error),
    #[error("filesystem operation failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("json serialization failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid sqlite url: {0}")]
    InvalidConnectionUrl(String),
    #[error("path is not valid UTF-8: {0}")]
    InvalidPath(String),
    #[error("run not found: {0}")]
    RunNotFound(String),
    #[error("workflow not found: {0}")]
    WorkflowNotFound(String),
    #[error("workflow already exists: {0}")]
    WorkflowAlreadyExists(String),
    #[error("connector record not found: {0}")]
    ConnectorRecordNotFound(String),
    #[error("node record not found: {0}")]
    NodeRecordNotFound(String),
    #[error("human task not found: {0}")]
    HumanTaskNotFound(String),
    #[error("data integrity error: {0}")]
    DataIntegrity(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("credential encryption failed: {0}")]
    CredentialEncryption(String),
    #[error("credential decryption failed: {0}")]
    CredentialDecryption(String),
}

fn credential_master_key() -> Result<[u8; 32], StorageError> {
    let encoded = env::var(CREDENTIAL_MASTER_KEY_ENV).map_err(|_| {
        StorageError::CredentialEncryption(format!(
            "missing master key env var {CREDENTIAL_MASTER_KEY_ENV}"
        ))
    })?;

    let bytes = BASE64.decode(encoded).map_err(|error| {
        StorageError::CredentialEncryption(format!("invalid base64 master key: {error}"))
    })?;

    if bytes.len() != 32 {
        return Err(StorageError::CredentialEncryption(format!(
            "master key in {CREDENTIAL_MASTER_KEY_ENV} must decode to 32 bytes"
        )));
    }

    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
}

fn encrypt_value(value: &str) -> Result<String, StorageError> {
    let key = credential_master_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|error| {
        StorageError::CredentialEncryption(format!("invalid cipher key: {error}"))
    })?;

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, value.as_bytes())
        .map_err(|error| StorageError::CredentialEncryption(format!("encrypt failed: {error}")))?;

    Ok(format!(
        "{CREDENTIAL_CIPHER_VERSION}:{}:{}",
        BASE64.encode(nonce_bytes),
        BASE64.encode(ciphertext)
    ))
}

fn encrypted_credential_segments(stored: &str) -> Option<(&str, &str)> {
    let payload =
        stored.strip_prefix(CREDENTIAL_CIPHER_VERSION).and_then(|value| value.strip_prefix(':'))?;
    let (nonce_b64, cipher_b64) = payload.split_once(':')?;
    if nonce_b64.is_empty() || cipher_b64.is_empty() {
        return None;
    }

    Some((nonce_b64, cipher_b64))
}

fn decrypt_value(stored: &str, credential_name: Option<&str>) -> Result<String, StorageError> {
    let Some((nonce_b64, cipher_b64)) = encrypted_credential_segments(stored) else {
        PLAINTEXT_CREDENTIALS_SEEN_TOTAL.fetch_add(1, Ordering::Relaxed);
        let queued_credential_name = credential_name.map(str::to_string);
        let credential = credential_name.unwrap_or("<unknown>");

        match plaintext_credential_migration_queue().write() {
            Ok(mut queue) => {
                queue.insert(queued_credential_name.clone());
            }
            Err(poisoned) => {
                tracing::warn!(
                    credential = %credential,
                    error = %poisoned,
                    "plaintext credential migration queue lock poisoned while enqueueing; recovering lock"
                );
                let mut queue = poisoned.into_inner();
                queue.insert(queued_credential_name);
            }
        }

        tracing::warn!(
            credential = %credential,
            expected_prefix = CREDENTIAL_CIPHER_VERSION,
            strict_mode = strict_credential_encryption_enabled(),
            plaintext_hits_total = PLAINTEXT_CREDENTIALS_SEEN_TOTAL.load(Ordering::Relaxed),
            "plaintext credential encountered in storage; queued for re-encryption migration"
        );

        if strict_credential_encryption_enabled() {
            return Err(StorageError::CredentialDecryption(format!(
                "plaintext credential encountered for {credential}; strict mode requires {CREDENTIAL_CIPHER_VERSION}"
            )));
        }

        return Ok(stored.to_string());
    };

    let key = credential_master_key()
        .map_err(|error| StorageError::CredentialDecryption(error.to_string()))?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|error| {
        StorageError::CredentialDecryption(format!("invalid cipher key: {error}"))
    })?;

    let nonce_bytes = BASE64.decode(nonce_b64).map_err(|error| {
        StorageError::CredentialDecryption(format!("invalid nonce encoding: {error}"))
    })?;
    if nonce_bytes.len() != 12 {
        return Err(StorageError::CredentialDecryption(
            "invalid nonce length for encrypted credential".to_string(),
        ));
    }

    let ciphertext = BASE64.decode(cipher_b64).map_err(|error| {
        StorageError::CredentialDecryption(format!("invalid ciphertext encoding: {error}"))
    })?;

    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|error| StorageError::CredentialDecryption(format!("decrypt failed: {error}")))?;

    String::from_utf8(plaintext).map_err(|error| {
        StorageError::CredentialDecryption(format!("decrypted value is not valid utf-8: {error}"))
    })
}

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_secs() as i64
}

fn escape_like_pattern(input: &str) -> String {
    input.replace("\\\\", "\\\\\\\\").replace('%', "\\\\%").replace('_', "\\\\_")
}

fn apply_log_filters(builder: &mut QueryBuilder<'_, Sqlite>, query: &LogQuery) {
    if let Some(run_id) = query.run_id.as_deref() {
        builder.push(" AND run_id = ");
        builder.push_bind(run_id.to_string());
    }
    if let Some(level) = query.level.as_deref() {
        builder.push(" AND level = ");
        builder.push_bind(level.to_string());
    }
    if let Some(search) = query.search.as_deref() {
        builder.push(" AND message LIKE ");
        let escaped = escape_like_pattern(search);
        builder.push_bind(format!("%{escaped}%"));
        builder.push(" ESCAPE '\\\\'");
    }
}

fn apply_run_filters(builder: &mut QueryBuilder<'_, Sqlite>, query: &RunQuery) {
    if let Some(workflow_name) = query.workflow_name.as_deref() {
        builder.push(" AND workflow_name = ");
        builder.push_bind(workflow_name.to_string());
    }
    if let Some(status) = query.status.as_deref() {
        builder.push(" AND status = ");
        builder.push_bind(status.to_string());
    }
    if let Some(started_after) = query.started_after {
        builder.push(" AND started_at >= ");
        builder.push_bind(started_after);
    }
    if let Some(started_before) = query.started_before {
        builder.push(" AND started_at <= ");
        builder.push_bind(started_before);
    }
}

async fn count_logs(store: &RunStore, query: &LogQuery) -> Result<u64, StorageError> {
    let mut builder = QueryBuilder::<Sqlite>::new("SELECT COUNT(*) AS count FROM logs WHERE 1 = 1");
    apply_log_filters(&mut builder, query);
    let row = builder.build().fetch_one(store.pool()).await?;
    Ok(row.try_get::<i64, _>("count")? as u64)
}

async fn count_runs(store: &RunStore, query: &RunQuery) -> Result<u64, StorageError> {
    let mut builder = QueryBuilder::<Sqlite>::new("SELECT COUNT(*) AS count FROM runs WHERE 1 = 1");
    apply_run_filters(&mut builder, query);
    let row = builder.build().fetch_one(store.pool()).await?;
    Ok(row.try_get::<i64, _>("count")? as u64)
}

fn map_run_row(row: sqlx::sqlite::SqliteRow) -> Result<RunRecord, StorageError> {
    Ok(RunRecord {
        id: row.try_get("id")?,
        workflow_name: row.try_get("workflow_name")?,
        status: row.try_get("status")?,
        started_at: row.try_get("started_at")?,
        finished_at: row.try_get("finished_at")?,
        error_message: row.try_get("error_message")?,
        workflow_revision: row.try_get("workflow_revision")?,
        editor_snapshot: row.try_get("editor_snapshot")?,
        workflow_snapshot: row.try_get("workflow_snapshot")?,
        initial_payload: row.try_get("initial_payload")?,
        state_json: row.try_get("state_json")?,
    })
}

fn map_workflow_row(row: sqlx::sqlite::SqliteRow) -> Result<WorkflowRecord, StorageError> {
    Ok(WorkflowRecord {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        yaml: row.try_get("yaml")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn map_connector_record_row(row: sqlx::sqlite::SqliteRow) -> Result<ConnectorRecord, StorageError> {
    Ok(ConnectorRecord {
        id: row.try_get("id")?,
        type_name: row.try_get("type_name")?,
        name: row.try_get("name")?,
        runtime: row.try_get("runtime")?,
        source_kind: row.try_get("source_kind")?,
        source_ref: row.try_get("source_ref")?,
        connector_dir: row.try_get("connector_dir")?,
        manifest_path: row.try_get("manifest_path")?,
        manifest_json: row.try_get("manifest_json")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn map_node_record_row(row: sqlx::sqlite::SqliteRow) -> Result<NodeRecord, StorageError> {
    Ok(NodeRecord {
        id: row.try_get("id")?,
        type_name: row.try_get("type_name")?,
        label: row.try_get("label")?,
        description: row.try_get("description")?,
        category: row.try_get("category")?,
        source_kind: row.try_get("source_kind")?,
        source_ref: row.try_get("source_ref")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn map_step_run_row(row: sqlx::sqlite::SqliteRow) -> Result<StepRunRecord, StorageError> {
    let attempt_i64 = row.try_get::<i64, _>("attempt")?;
    let attempt = u32::try_from(attempt_i64).map_err(|_| {
        StorageError::DataIntegrity(format!(
            "step_runs.attempt out of range for u32: {attempt_i64}"
        ))
    })?;

    Ok(StepRunRecord {
        id: row.try_get("id")?,
        run_id: row.try_get("run_id")?,
        step_id: row.try_get("step_id")?,
        status: row.try_get("status")?,
        started_at: row.try_get("started_at")?,
        finished_at: row.try_get("finished_at")?,
        attempt,
        input: row.try_get("input")?,
        output: row.try_get("output")?,
        error_message: row.try_get("error_message")?,
    })
}

fn map_log_row(row: sqlx::sqlite::SqliteRow) -> Result<LogRecord, StorageError> {
    Ok(LogRecord {
        id: row.try_get("id")?,
        run_id: row.try_get("run_id")?,
        step_id: row.try_get("step_id")?,
        timestamp: row.try_get("timestamp")?,
        level: row.try_get("level")?,
        message: row.try_get("message")?,
    })
}

fn map_human_task_row(row: sqlx::sqlite::SqliteRow) -> Result<HumanTaskRecord, StorageError> {
    Ok(HumanTaskRecord {
        id: row.try_get("id")?,
        run_id: row.try_get("run_id")?,
        step_run_id: row.try_get("step_run_id")?,
        step_id: row.try_get("step_id")?,
        kind: row.try_get("kind")?,
        status: row.try_get("status")?,
        prompt: row.try_get("prompt")?,
        field: row.try_get("field")?,
        details: row.try_get("details")?,
        response: row.try_get("response")?,
        created_at: row.try_get("created_at")?,
        completed_at: row.try_get("completed_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    struct ScopedEnvVarRestore {
        key: &'static str,
        original: Option<OsString>,
    }

    impl ScopedEnvVarRestore {
        fn new_cleared(key: &'static str) -> Self {
            let original = std::env::var_os(key);
            std::env::remove_var(key);
            Self { key, original }
        }

        fn new_set(key: &'static str, value: &str) -> Self {
            let original = std::env::var_os(key);
            std::env::set_var(key, value);
            Self { key, original }
        }
    }

    impl Drop for ScopedEnvVarRestore {
        fn drop(&mut self) {
            if let Some(value) = &self.original {
                std::env::set_var(self.key, value);
            } else {
                std::env::remove_var(self.key);
            }
        }
    }

    #[test]
    fn encrypted_credential_segments_require_full_delimited_format() {
        assert_eq!(
            encrypted_credential_segments("enc:v1:bm9uY2U=:Y2lwaGVydGV4dA=="),
            Some(("bm9uY2U=", "Y2lwaGVydGV4dA=="))
        );
        assert_eq!(encrypted_credential_segments("enc:v1-some-api-key"), None);
        assert_eq!(encrypted_credential_segments("enc:v1"), None);
        assert_eq!(encrypted_credential_segments("enc:v1:"), None);
        assert_eq!(encrypted_credential_segments("enc:v1:nonce"), None);
        assert_eq!(encrypted_credential_segments("enc:v1::cipher"), None);
    }

    #[test]
    fn decrypt_value_preserves_prefix_lookalike_plaintext_values() {
        let _strict_env = ScopedEnvVarRestore::new_cleared("ACSA_STRICT_CREDENTIAL_ENCRYPTION");
        let stored = "enc:v1-some-api-key";
        let decrypted = decrypt_value(stored, Some("api_key"))
            .expect("prefix lookalike value should be treated as plaintext");
        assert_eq!(decrypted, stored);
    }

    #[test]
    fn decrypt_value_without_name_queues_none_sentinel() {
        let _strict_env = ScopedEnvVarRestore::new_cleared("ACSA_STRICT_CREDENTIAL_ENCRYPTION");
        {
            let mut queue = plaintext_credential_migration_queue()
                .write()
                .expect("queue lock should be acquired");
            queue.clear();
        }

        let _ = decrypt_value("plain-secret", None);

        let queue =
            plaintext_credential_migration_queue().read().expect("queue lock should be acquired");
        assert!(queue.contains(&None));
        assert!(!queue.contains(&Some("<unknown>".to_string())));
    }

    #[tokio::test]
    async fn upsert_credential_rejects_blank_names() {
        let _master_key_env = ScopedEnvVarRestore::new_set(
            "ACSA_CREDENTIAL_MASTER_KEY",
            "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
        );
        let temp_dir = std::env::temp_dir().join(format!("acsa-storage-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&temp_dir).await.expect("temp dir should be created");
        let db_path = temp_dir.join("runs.sqlite");
        let store = RunStore::connect(&db_path).await.expect("store should connect");

        let error = store
            .upsert_credential("   ", "secret")
            .await
            .expect_err("blank credential name should be rejected");
        assert!(matches!(error, StorageError::InvalidInput(_)));

        tokio::fs::remove_dir_all(&temp_dir).await.expect("temp dir should be removed");
    }

    #[tokio::test]
    async fn workflow_crud_is_db_backed() {
        let temp_dir = std::env::temp_dir().join(format!("acsa-storage-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&temp_dir).await.expect("temp dir should be created");
        let db_path = temp_dir.join("runs.sqlite");
        let store = RunStore::connect(&db_path).await.expect("store should connect");

        let created = store
            .create_workflow(
                "customer-intake",
                "customer intake",
                "version: v1\nname: customer intake\ntrigger:\n  type: manual\nsteps: []\n",
            )
            .await
            .expect("workflow should create");
        assert_eq!(created.id, "customer-intake");

        let listed = store.list_workflows().await.expect("workflows should list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "customer-intake");

        let updated = store
            .update_workflow(
                "customer-intake",
                "customer intake",
                "version: v1\nname: customer intake\ntrigger:\n  type: manual\nsteps:\n  - id: start\n    type: constant\n    params:\n      value: true\n    next: []\n",
            )
            .await
            .expect("workflow should update");
        assert!(updated.yaml.contains("id: start"));

        let renamed = store
            .rename_workflow(
                "customer-intake",
                "customer-intake-v2",
                "customer intake v2",
                "version: v1\nname: customer intake v2\ntrigger:\n  type: manual\nsteps: []\n",
            )
            .await
            .expect("workflow should rename");
        assert_eq!(renamed.id, "customer-intake-v2");
        assert_eq!(renamed.name, "customer intake v2");

        store.delete_workflow("customer-intake-v2").await.expect("workflow should delete");
        let error = store
            .get_workflow("customer-intake-v2")
            .await
            .expect_err("deleted workflow should not load");
        assert!(matches!(error, StorageError::WorkflowNotFound(_)));

        tokio::fs::remove_dir_all(&temp_dir).await.expect("temp dir should be removed");
    }

    #[tokio::test]
    async fn create_workflow_if_missing_preserves_existing_yaml() {
        let temp_dir = std::env::temp_dir().join(format!("acsa-storage-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&temp_dir).await.expect("temp dir should be created");
        let db_path = temp_dir.join("runs.sqlite");
        let store = RunStore::connect(&db_path).await.expect("store should connect");

        store
            .create_workflow(
                "seeded",
                "seeded workflow",
                "version: v1\nname: seeded workflow\ntrigger:\n  type: manual\nsteps: []\n",
            )
            .await
            .expect("workflow should create");

        let seeded = store
            .create_workflow_if_missing(
                "seeded",
                "replacement workflow",
                "version: v1\nname: replacement workflow\ntrigger:\n  type: manual\nsteps:\n  - id: replacement\n    type: constant\n    params:\n      value: true\n    next: []\n",
            )
            .await
            .expect("seed should preserve existing record");

        assert_eq!(seeded.name, "seeded workflow");
        assert!(!seeded.yaml.contains("replacement"));

        tokio::fs::remove_dir_all(&temp_dir).await.expect("temp dir should be removed");
    }

    #[tokio::test]
    async fn connector_record_crud_is_db_backed() {
        let temp_dir = std::env::temp_dir().join(format!("acsa-storage-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&temp_dir).await.expect("temp dir should be created");
        let db_path = temp_dir.join("runs.sqlite");
        let store = RunStore::connect(&db_path).await.expect("store should connect");

        let created = store
            .upsert_connector_record(NewConnectorRecord {
                type_name: "slack_notify",
                name: "Slack Notify",
                runtime: "process",
                source_kind: "starter_pack",
                source_ref: Some("slack-notify"),
                connector_dir: "connectors/slack-notify",
                manifest_path: "connectors/slack-notify/manifest.json",
                manifest_json: r#"{"name":"Slack Notify","runtime":"process","type":"slack_notify"}"#,
            })
            .await
            .expect("connector record should create");

        let listed = store.list_connector_records().await.expect("connector records should list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].type_name, "slack_notify");
        assert_eq!(listed[0].source_ref.as_deref(), Some("slack-notify"));

        let updated = store
            .upsert_connector_record(NewConnectorRecord {
                type_name: "slack_notify",
                name: "Slack Notify",
                runtime: "process",
                source_kind: "generated",
                source_ref: Some("prompt:123"),
                connector_dir: "connectors/slack-notify",
                manifest_path: "connectors/slack-notify/manifest.json",
                manifest_json: r#"{"name":"Slack Notify","runtime":"process","type":"slack_notify","version":"2"}"#,
            })
            .await
            .expect("connector record should update");

        assert_eq!(updated.id, created.id);
        assert_eq!(updated.source_kind, "generated");
        assert_eq!(updated.source_ref.as_deref(), Some("prompt:123"));
        assert!(updated.manifest_json.contains("\"version\":\"2\""));

        tokio::fs::remove_dir_all(&temp_dir).await.expect("temp dir should be removed");
    }

    #[tokio::test]
    async fn node_record_crud_is_db_backed() {
        let temp_dir = std::env::temp_dir().join(format!("acsa-storage-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&temp_dir).await.expect("temp dir should be created");
        let db_path = temp_dir.join("runs.sqlite");
        let store = RunStore::connect(&db_path).await.expect("store should connect");

        let created = store
            .upsert_node_record(NewNodeRecord {
                type_name: "custom_summary",
                label: "Summarize payload",
                description: "Summarize incoming payloads for the team.",
                category: "AI",
                source_kind: "generated",
                source_ref: Some("prompt:node-1"),
            })
            .await
            .expect("node record should create");

        let listed = store.list_node_records().await.expect("node records should list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].type_name, "custom_summary");

        let updated = store
            .upsert_node_record(NewNodeRecord {
                type_name: "custom_summary",
                label: "Summarize payload",
                description: "Summarize incoming payloads in a friendlier tone.",
                category: "AI",
                source_kind: "custom",
                source_ref: Some("user-edit"),
            })
            .await
            .expect("node record should update");

        assert_eq!(updated.id, created.id);
        assert_eq!(updated.source_kind, "custom");
        assert_eq!(updated.source_ref.as_deref(), Some("user-edit"));
        assert!(updated.description.contains("friendlier tone"));

        tokio::fs::remove_dir_all(&temp_dir).await.expect("temp dir should be removed");
    }

    struct InsertRunArgs<'a> {
        editor_snapshot: Option<&'a str>,
        finished_at: Option<i64>,
        id: &'a str,
        started_at: i64,
        state_json: Option<&'a str>,
        workflow_name: &'a str,
        workflow_revision: Option<&'a str>,
        workflow_snapshot: Option<&'a str>,
    }

    async fn insert_run(store: &RunStore, args: InsertRunArgs<'_>) {
        sqlx::query(
            r#"
            INSERT INTO runs (
              id,
              workflow_name,
              status,
              started_at,
              finished_at,
              error_message,
              workflow_revision,
              editor_snapshot,
              workflow_snapshot,
              initial_payload,
              state_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(args.id)
        .bind(args.workflow_name)
        .bind("success")
        .bind(args.started_at)
        .bind(args.finished_at)
        .bind(Option::<String>::None)
        .bind(args.workflow_revision)
        .bind(args.editor_snapshot)
        .bind(args.workflow_snapshot)
        .bind(Option::<String>::None)
        .bind(args.state_json)
        .execute(store.pool())
        .await
        .expect("run should insert");
    }

    #[tokio::test]
    async fn latest_runs_for_workflows_is_targeted_and_deterministic() {
        let temp_dir = std::env::temp_dir().join(format!("acsa-storage-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&temp_dir).await.expect("temp dir should be created");
        let db_path = temp_dir.join("runs.sqlite");
        let store = RunStore::connect(&db_path).await.expect("store should connect");

        for index in 0..256 {
            let workflow_name = format!("background-{}", index % 8);
            insert_run(
                &store,
                InsertRunArgs {
                    editor_snapshot: Some("historical editor snapshot"),
                    finished_at: Some(1_100 + index as i64),
                    id: &format!("background-run-{index}"),
                    started_at: 1_000 + index as i64,
                    state_json: None,
                    workflow_name: &workflow_name,
                    workflow_revision: Some("sha256:background"),
                    workflow_snapshot: Some("saved workflow snapshot"),
                },
            )
            .await;
        }

        insert_run(
            &store,
            InsertRunArgs {
                editor_snapshot: None,
                finished_at: Some(50),
                id: "target-plain",
                started_at: 42,
                state_json: None,
                workflow_name: "target workflow",
                workflow_revision: Some("sha256:plain"),
                workflow_snapshot: Some("saved workflow snapshot"),
            },
        )
        .await;
        insert_run(
            &store,
            InsertRunArgs {
                editor_snapshot: Some("historical editor snapshot"),
                finished_at: Some(50),
                id: "target-rich",
                started_at: 42,
                state_json: Some(r#"{ "render": "degraded" }"#),
                workflow_name: "target workflow",
                workflow_revision: Some("sha256:rich"),
                workflow_snapshot: Some("saved workflow snapshot"),
            },
        )
        .await;

        let runs = store
            .latest_runs_for_workflows(&["target workflow".to_string()])
            .await
            .expect("latest runs should load");
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].id, "target-rich");
        assert_eq!(runs[0].workflow_name, "target workflow");

        tokio::fs::remove_dir_all(&temp_dir).await.expect("temp dir should be removed");
    }

    #[tokio::test]
    async fn latest_runs_for_workflows_treats_null_finished_at_like_started_at() {
        let temp_dir = std::env::temp_dir().join(format!("acsa-storage-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&temp_dir).await.expect("temp dir should be created");
        let db_path = temp_dir.join("runs.sqlite");
        let store = RunStore::connect(&db_path).await.expect("store should connect");

        insert_run(
            &store,
            InsertRunArgs {
                editor_snapshot: Some("historical editor snapshot"),
                finished_at: Some(42),
                id: "run-a",
                started_at: 42,
                state_json: Some(r#"{ "render": "degraded" }"#),
                workflow_name: "target workflow",
                workflow_revision: Some("sha256:a"),
                workflow_snapshot: Some("saved workflow snapshot"),
            },
        )
        .await;
        insert_run(
            &store,
            InsertRunArgs {
                editor_snapshot: Some("historical editor snapshot"),
                finished_at: None,
                id: "run-z",
                started_at: 42,
                state_json: Some(r#"{ "render": "degraded" }"#),
                workflow_name: "target workflow",
                workflow_revision: Some("sha256:z"),
                workflow_snapshot: Some("saved workflow snapshot"),
            },
        )
        .await;

        let runs = store
            .latest_runs_for_workflows(&["target workflow".to_string()])
            .await
            .expect("latest runs should load");
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].id, "run-z");

        tokio::fs::remove_dir_all(&temp_dir).await.expect("temp dir should be removed");
    }

    #[tokio::test]
    async fn start_run_persists_workflow_revision_identity() {
        let temp_dir = std::env::temp_dir().join(format!("acsa-storage-{}", Uuid::new_v4()));
        tokio::fs::create_dir_all(&temp_dir).await.expect("temp dir should be created");
        let db_path = temp_dir.join("runs.sqlite");
        let store = RunStore::connect(&db_path).await.expect("store should connect");

        let workflow_snapshot = r#"
version: v1
name: customer intake
trigger:
  type: manual
steps:
  - id: start
    type: constant
    params:
      value: true
    next: []
"#;
        let run = store
            .start_run(
                "customer intake",
                "sha256:test-revision",
                workflow_snapshot,
                Some(workflow_snapshot),
                &serde_json::json!({ "source": "test" }),
            )
            .await
            .expect("run should start");
        let loaded = store.get_run(&run.id).await.expect("run should load");

        assert_eq!(loaded.workflow_name, "customer intake");
        assert_eq!(loaded.workflow_revision.as_deref(), Some("sha256:test-revision"));
        assert_eq!(loaded.workflow_snapshot.as_deref(), Some(workflow_snapshot));
        assert_eq!(loaded.editor_snapshot.as_deref(), Some(workflow_snapshot));

        sqlx::query(
            r#"
            INSERT INTO runs (
              id,
              workflow_name,
              status,
              started_at,
              finished_at,
              error_message,
              workflow_revision,
              editor_snapshot,
              workflow_snapshot,
              initial_payload,
              state_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind("legacy-json-run")
        .bind("legacy flow")
        .bind("paused")
        .bind(42_i64)
        .bind(Option::<i64>::None)
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind(r#"{"version":"v1","name":"legacy flow","trigger":{"type":"manual","details":{}},"steps":[{"id":"start","type":"constant","params":{"value":true},"next":["approve"]},{"id":"approve","type":"approval","params":{"prompt":"Approve this request?"},"next":["finish"],"retry":null,"timeout_ms":1000},{"id":"finish","type":"echo","params":{},"next":[],"retry":null,"timeout_ms":1000}],"ui":{"positions":{},"detached_steps":[]}}"#)
        .bind(Some(r#"{"trigger":"manual"}"#))
        .bind(Some(r#"{"activation_votes":{"start":0,"approve":1,"finish":0},"outputs":{"start":{"value":true}},"ready_steps":[],"remaining_dependencies":{"approve":0,"finish":1}}"#))
        .execute(store.pool())
        .await
        .expect("legacy run should insert");

        let legacy = store.get_run("legacy-json-run").await.expect("legacy run should load");
        assert_eq!(legacy.workflow_revision, None);
        assert!(legacy
            .workflow_snapshot
            .as_deref()
            .expect("legacy workflow snapshot should exist")
            .contains("\"name\":\"legacy flow\""));

        tokio::fs::remove_dir_all(&temp_dir).await.expect("temp dir should be removed");
    }
}
