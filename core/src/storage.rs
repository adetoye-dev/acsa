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
    path::Path,
    str::FromStr,
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::Value;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    Row, SqlitePool,
};
use thiserror::Error;
use uuid::Uuid;

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
        let store = Self { pool };
        store.initialize().await?;
        store.mark_incomplete_runs_failed().await?;
        Ok(store)
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn start_run(&self, workflow_name: &str) -> Result<RunRecord, StorageError> {
        let record = RunRecord {
            id: Uuid::new_v4().to_string(),
            workflow_name: workflow_name.to_string(),
            status: RunStatus::Running.as_str().to_string(),
            started_at: current_timestamp(),
            finished_at: None,
            error_message: None,
        };

        sqlx::query(
            r#"
            INSERT INTO runs (id, workflow_name, status, started_at, finished_at, error_message)
            VALUES (?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&record.id)
        .bind(&record.workflow_name)
        .bind(&record.status)
        .bind(record.started_at)
        .bind(record.finished_at)
        .bind(&record.error_message)
        .execute(&self.pool)
        .await?;

        Ok(record)
    }

    pub async fn complete_run_success(&self, run_id: &str) -> Result<(), StorageError> {
        let result = sqlx::query(
            r#"
            UPDATE runs
            SET status = ?, finished_at = ?, error_message = NULL
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
            SET status = ?, finished_at = ?, error_message = ?
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

    pub async fn list_runs(&self) -> Result<Vec<RunRecord>, StorageError> {
        let rows = sqlx::query(
            r#"
            SELECT id, workflow_name, status, started_at, finished_at, error_message
            FROM runs
            ORDER BY started_at DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(map_run_row).collect()
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

    async fn initialize(&self) -> Result<(), StorageError> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS runs (
              id TEXT PRIMARY KEY,
              workflow_name TEXT NOT NULL,
              status TEXT NOT NULL,
              started_at INTEGER NOT NULL,
              finished_at INTEGER,
              error_message TEXT
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

        sqlx::query("CREATE INDEX IF NOT EXISTS idx_runs_workflow_name ON runs(workflow_name)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_step_runs_run_id ON step_runs(run_id)")
            .execute(&self.pool)
            .await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_logs_run_id ON logs(run_id)")
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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunRecord {
    pub id: String,
    pub workflow_name: String,
    pub status: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub error_message: Option<String>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunStatus {
    Failed,
    Running,
    Success,
}

impl RunStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Failed => "failed",
            Self::Running => "running",
            Self::Success => "success",
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
    #[error("data integrity error: {0}")]
    DataIntegrity(String),
}

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_secs() as i64
}

fn map_run_row(row: sqlx::sqlite::SqliteRow) -> Result<RunRecord, StorageError> {
    Ok(RunRecord {
        id: row.try_get("id")?,
        workflow_name: row.try_get("workflow_name")?,
        status: row.try_get("status")?,
        started_at: row.try_get("started_at")?,
        finished_at: row.try_get("finished_at")?,
        error_message: row.try_get("error_message")?,
    })
}

fn map_step_run_row(row: sqlx::sqlite::SqliteRow) -> Result<StepRunRecord, StorageError> {
    let attempt_i64 = row.try_get::<i64, _>("attempt")?;
    let attempt = u32::try_from(attempt_i64).map_err(|_| {
        StorageError::DataIntegrity(format!("step_runs.attempt out of range for u32: {attempt_i64}"))
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
