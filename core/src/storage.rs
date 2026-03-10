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

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    QueryBuilder, Row, Sqlite, SqlitePool,
};
use thiserror::Error;
use uuid::Uuid;

use crate::observability::{HistogramBucket, HistogramSnapshot, MetricsSnapshot};

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

    pub async fn start_run(
        &self,
        workflow_name: &str,
        workflow_snapshot: &str,
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
              workflow_snapshot,
              initial_payload,
              state_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&record.id)
        .bind(&record.workflow_name)
        .bind(&record.status)
        .bind(record.started_at)
        .bind(record.finished_at)
        .bind(&record.error_message)
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
            SELECT id, workflow_name, status, started_at, finished_at, error_message, workflow_snapshot, initial_payload, state_json
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

    pub async fn list_runs_page(
        &self,
        query: &RunQuery,
    ) -> Result<PaginatedResponse<RunRecord>, StorageError> {
        let total = count_runs(self, query).await?;
        let mut builder = QueryBuilder::<Sqlite>::new(
            "SELECT id, workflow_name, status, started_at, finished_at, error_message, workflow_snapshot, initial_payload, state_json FROM runs WHERE 1 = 1",
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
              workflow_snapshot TEXT,
              initial_payload TEXT,
              state_json TEXT
            )
            "#,
        )
        .execute(&self.pool)
        .await?;
        self.ensure_column("runs", "workflow_snapshot", "TEXT").await?;
        self.ensure_column("runs", "initial_payload", "TEXT").await?;
        self.ensure_column("runs", "state_json", "TEXT").await?;

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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunRecord {
    pub id: String,
    pub workflow_name: String,
    pub status: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub error_message: Option<String>,
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
    #[error("human task not found: {0}")]
    HumanTaskNotFound(String),
    #[error("data integrity error: {0}")]
    DataIntegrity(String),
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
        workflow_snapshot: row.try_get("workflow_snapshot")?,
        initial_payload: row.try_get("initial_payload")?,
        state_json: row.try_get("state_json")?,
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
