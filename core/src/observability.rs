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
    env,
    path::PathBuf,
    sync::{Once, OnceLock},
};

use serde_json::{Map, Value};
use tokio::io::AsyncWriteExt;
use tracing_subscriber::{fmt, EnvFilter};

use crate::storage::{RunStore, StorageError};

const DEFAULT_LOG_LEVEL: &str = "info";
const MAX_LOG_MESSAGE_LENGTH: usize = 2_000;

static TRACE_INIT: Once = Once::new();
static FILE_LOG_PATH: OnceLock<Option<PathBuf>> = OnceLock::new();
static PAYLOAD_VISIBILITY: OnceLock<bool> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Error,
    Info,
    Warn,
}

impl LogLevel {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Info => "info",
            Self::Warn => "warn",
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct MetricsSnapshot {
    pub step_duration_histogram: HistogramSnapshot,
    pub step_executions_total: u64,
    pub step_failures_total: u64,
    pub step_retries_total: u64,
    pub workflow_average_duration_seconds: f64,
    pub workflow_duration_histogram: HistogramSnapshot,
    pub workflow_runs_failed_total: u64,
    pub workflow_runs_paused_total: u64,
    pub workflow_runs_running_total: u64,
    pub workflow_runs_success_total: u64,
    pub workflow_runs_total: u64,
}

#[derive(Debug, Clone, Default)]
pub struct HistogramSnapshot {
    pub buckets: Vec<HistogramBucket>,
    pub count: u64,
    pub sum: f64,
}

#[derive(Debug, Clone)]
pub struct HistogramBucket {
    pub count: u64,
    pub le: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetentionPolicy {
    pub log_retention_days: Option<u64>,
    pub run_retention_days: Option<u64>,
}

impl RetentionPolicy {
    pub fn from_env() -> Option<Self> {
        let log_retention_days = env_u64("ACSA_LOG_RETENTION_DAYS");
        let run_retention_days = env_u64("ACSA_RUN_RETENTION_DAYS");
        if log_retention_days.is_none() && run_retention_days.is_none() {
            return None;
        }
        Some(Self { log_retention_days, run_retention_days })
    }

    pub fn log_cutoff_timestamp(self, now: i64) -> Option<i64> {
        self.log_retention_days.and_then(|days| {
            let seconds = days.checked_mul(24 * 60 * 60)?;
            Some(now.saturating_sub(seconds as i64))
        })
    }

    pub fn run_cutoff_timestamp(self, now: i64) -> Option<i64> {
        self.run_retention_days.and_then(|days| {
            let seconds = days.checked_mul(24 * 60 * 60)?;
            Some(now.saturating_sub(seconds as i64))
        })
    }
}

pub fn current_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_secs() as i64
}

pub fn init_tracing() {
    TRACE_INIT.call_once(|| {
        let filter =
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_LOG_LEVEL));
        fmt().with_env_filter(filter).with_target(false).compact().init();
    });
}

pub fn metrics_text(snapshot: &MetricsSnapshot) -> String {
    let mut lines = Vec::new();
    lines.extend(render_counter(
        "acsa_workflow_runs_total",
        "Total workflow runs recorded by the engine",
        snapshot.workflow_runs_total,
    ));
    lines.push(metric_line(
        "acsa_workflow_runs_success_total",
        snapshot.workflow_runs_success_total,
    ));
    lines.push(metric_line("acsa_workflow_runs_failed_total", snapshot.workflow_runs_failed_total));
    lines.push(metric_line("acsa_workflow_runs_paused_total", snapshot.workflow_runs_paused_total));
    lines.push(metric_line(
        "acsa_workflow_runs_running_total",
        snapshot.workflow_runs_running_total,
    ));
    lines.extend(render_counter(
        "acsa_step_executions_total",
        "Total step attempts recorded by the engine",
        snapshot.step_executions_total,
    ));
    lines.push(metric_line("acsa_step_failures_total", snapshot.step_failures_total));
    lines.push(metric_line("acsa_step_retries_total", snapshot.step_retries_total));
    lines.extend(render_gauge(
        "acsa_workflow_average_duration_seconds",
        "Average workflow duration in seconds for completed runs",
        snapshot.workflow_average_duration_seconds,
    ));
    lines.extend(render_histogram(
        "acsa_workflow_duration_seconds",
        "Workflow duration histogram in seconds",
        &snapshot.workflow_duration_histogram,
    ));
    lines.extend(render_histogram(
        "acsa_step_duration_seconds",
        "Step duration histogram in seconds",
        &snapshot.step_duration_histogram,
    ));
    lines.join("\n")
}

pub fn payload_visibility_enabled() -> bool {
    *PAYLOAD_VISIBILITY.get_or_init(|| match env::var("ACSA_LOG_PAYLOADS") {
        Ok(value) => !matches!(value.as_str(), "0" | "false" | "FALSE" | "False"),
        Err(_) => true,
    })
}

pub async fn record_log(
    store: &RunStore,
    level: LogLevel,
    run_id: Option<&str>,
    step_id: Option<&str>,
    message: impl Into<String>,
) -> Result<(), StorageError> {
    let message = redact_text(&message.into());

    match level {
        LogLevel::Error => {
            tracing::error!(run_id = run_id.unwrap_or(""), step_id = step_id.unwrap_or(""), message = %message);
        }
        LogLevel::Info => {
            tracing::info!(run_id = run_id.unwrap_or(""), step_id = step_id.unwrap_or(""), message = %message);
        }
        LogLevel::Warn => {
            tracing::warn!(run_id = run_id.unwrap_or(""), step_id = step_id.unwrap_or(""), message = %message);
        }
    }

    store.append_log(run_id, step_id, level.as_str(), &message).await?;
    append_file_log(level, run_id, step_id, &message);
    Ok(())
}

pub fn redact_json(value: &Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.iter().map(redact_json).collect()),
        Value::Object(object) => {
            let mut redacted = Map::with_capacity(object.len());
            for (key, value) in object {
                if looks_sensitive_key(key) {
                    redacted.insert(key.clone(), Value::String(mask_secret_value(value)));
                } else {
                    redacted.insert(key.clone(), redact_json(value));
                }
            }
            Value::Object(redacted)
        }
        other => other.clone(),
    }
}

pub fn redact_json_string(raw: &str) -> String {
    match serde_json::from_str::<Value>(raw) {
        Ok(value) => {
            serde_json::to_string_pretty(&redact_json(&value)).unwrap_or_else(|_| redact_text(raw))
        }
        Err(_) => redact_text(raw),
    }
}

pub fn redact_text(text: &str) -> String {
    let redacted = redact_bearer_tokens(text);
    let redacted = redact_key_value_patterns(&redacted);
    let redacted = redact_postgres_dsn_passwords(&redacted);
    truncate_message(&redacted)
}

fn append_file_log(level: LogLevel, run_id: Option<&str>, step_id: Option<&str>, message: &str) {
    let path = FILE_LOG_PATH
        .get_or_init(|| env::var("ACSA_LOG_FILE_PATH").ok().map(PathBuf::from))
        .clone();
    let Some(path) = path else {
        return;
    };
    let line = format!(
        "{} level={} run_id={} step_id={} message={}\n",
        current_timestamp(),
        level.as_str(),
        run_id.unwrap_or("-"),
        step_id.unwrap_or("-"),
        message
    );

    tokio::spawn(async move {
        if let Some(parent) = path.parent() {
            if let Err(error) = tokio::fs::create_dir_all(parent).await {
                tracing::warn!(path = ?path, error = %error, "failed to create log directory");
                return;
            }
        }
        match tokio::fs::OpenOptions::new().create(true).append(true).open(&path).await {
            Ok(mut file) => {
                if let Err(error) = file.write_all(line.as_bytes()).await {
                    tracing::warn!(path = ?path, error = %error, "failed to write file log");
                }
            }
            Err(error) => {
                tracing::warn!(path = ?path, error = %error, "failed to open log file");
            }
        }
    });
}

fn env_u64(key: &str) -> Option<u64> {
    env::var(key).ok()?.parse().ok()
}

fn looks_sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.contains("secret")
        || key.contains("token")
        || key.contains("password")
        || key.contains("credential")
        || key.contains("api_key")
        || key.contains("apikey")
        || key.contains("authorization")
}

fn mask_secret_value(value: &Value) -> String {
    let candidate = match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    };

    if candidate.len() <= 4 {
        return "••••".to_string();
    }

    let suffix =
        candidate.chars().rev().take(4).collect::<String>().chars().rev().collect::<String>();
    format!("••••{suffix}")
}

fn metric_line(name: &str, value: u64) -> String {
    format!("{name} {value}")
}

fn render_counter(name: &str, help: &str, value: u64) -> Vec<String> {
    vec![
        format!("# HELP {name} {help}"),
        format!("# TYPE {name} counter"),
        metric_line(name, value),
    ]
}

fn render_gauge(name: &str, help: &str, value: f64) -> Vec<String> {
    vec![
        format!("# HELP {name} {help}"),
        format!("# TYPE {name} gauge"),
        format!("{name} {:.6}", value),
    ]
}

fn render_histogram(name: &str, help: &str, histogram: &HistogramSnapshot) -> Vec<String> {
    let mut lines = vec![format!("# HELP {name} {help}"), format!("# TYPE {name} histogram")];
    for bucket in &histogram.buckets {
        lines.push(format!(r#"{name}_bucket{{le="{:.1}"}} {}"#, bucket.le, bucket.count));
    }
    lines.push(format!(r#"{name}_bucket{{le="+Inf"}} {}"#, histogram.count));
    lines.push(format!("{name}_sum {:.6}", histogram.sum));
    lines.push(format!("{name}_count {}", histogram.count));
    lines
}

fn truncate_message(message: &str) -> String {
    let mut truncated = message.chars().take(MAX_LOG_MESSAGE_LENGTH).collect::<String>();
    if message.chars().count() > MAX_LOG_MESSAGE_LENGTH {
        truncated.push_str("… [truncated]");
    }
    truncated
}

fn redact_bearer_tokens(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let mut redacted = String::with_capacity(text.len());
    let mut cursor = 0usize;

    while let Some(relative) = lower[cursor..].find("bearer ") {
        let start = cursor + relative;
        let value_start = start + "bearer ".len();
        let value_end = text[value_start..]
            .find(is_secret_delimiter)
            .map(|offset| value_start + offset)
            .unwrap_or(text.len());
        redacted.push_str(&text[cursor..value_start]);
        if value_end > value_start {
            redacted.push_str("••••");
        }
        cursor = value_end;
    }

    redacted.push_str(&text[cursor..]);
    redacted
}

fn redact_key_value_patterns(text: &str) -> String {
    const SENSITIVE_KEYS: &[&str] =
        &["token", "secret", "password", "credential", "api_key", "apikey", "authorization"];

    let mut redacted = text.to_string();
    for key in SENSITIVE_KEYS {
        redacted = redact_key_assignment(&redacted, key, '=');
        redacted = redact_key_assignment(&redacted, key, ':');
    }
    redacted
}

fn redact_key_assignment(text: &str, key: &str, separator: char) -> String {
    let lower = text.to_ascii_lowercase();
    let pattern = format!("{key}{separator}");
    let mut redacted = String::with_capacity(text.len());
    let mut cursor = 0usize;

    while let Some(relative) = lower[cursor..].find(&pattern) {
        let key_start = cursor + relative;
        if key_start > 0 {
            let previous = text[..key_start].chars().next_back().unwrap_or(' ');
            if previous.is_ascii_alphanumeric() || previous == '_' || previous == '-' {
                redacted.push_str(&text[cursor..(key_start + pattern.len())]);
                cursor = key_start + pattern.len();
                continue;
            }
        }

        let value_start = key_start + pattern.len();
        let trimmed_start = if separator == ':' {
            value_start
                + text[value_start..]
                    .chars()
                    .take_while(|character| character.is_whitespace())
                    .map(char::len_utf8)
                    .sum::<usize>()
        } else {
            value_start
        };
        let value_end = text[trimmed_start..]
            .find(is_secret_delimiter)
            .map(|offset| trimmed_start + offset)
            .unwrap_or(text.len());

        redacted.push_str(&text[cursor..trimmed_start]);
        if value_end > trimmed_start {
            redacted.push_str("••••");
        }
        cursor = value_end;
    }

    redacted.push_str(&text[cursor..]);
    redacted
}

fn redact_postgres_dsn_passwords(text: &str) -> String {
    let mut redacted = text.to_string();
    for scheme in ["postgres://", "postgresql://"] {
        redacted = redact_dsn_scheme(&redacted, scheme);
    }
    redacted
}

fn redact_dsn_scheme(text: &str, scheme: &str) -> String {
    let mut redacted = String::with_capacity(text.len());
    let mut cursor = 0usize;
    let lower = text.to_ascii_lowercase();
    let lower_scheme = scheme.to_ascii_lowercase();

    while let Some(relative) = lower[cursor..].find(&lower_scheme) {
        let start = cursor + relative;
        let segment_end = text[start..]
            .find(is_secret_delimiter)
            .map(|offset| start + offset)
            .unwrap_or(text.len());
        let segment = &text[start..segment_end];
        redacted.push_str(&text[cursor..start]);
        redacted.push_str(&mask_postgres_dsn(segment));
        cursor = segment_end;
    }

    redacted.push_str(&text[cursor..]);
    redacted
}

fn mask_postgres_dsn(segment: &str) -> String {
    let Some(authority_index) = segment.find("://").map(|index| index + 3) else {
        return segment.to_string();
    };
    let Some(at_index) = segment[authority_index..].find('@').map(|index| authority_index + index)
    else {
        return segment.to_string();
    };
    let Some(colon_index) =
        segment[authority_index..at_index].find(':').map(|index| authority_index + index)
    else {
        return segment.to_string();
    };

    let mut masked = String::with_capacity(segment.len());
    masked.push_str(&segment[..(colon_index + 1)]);
    masked.push_str("••••");
    masked.push_str(&segment[at_index..]);
    masked
}

fn is_secret_delimiter(character: char) -> bool {
    character.is_whitespace() || matches!(character, '"' | '\'' | ',' | ';' | ')' | ']' | '}' | '&')
}

#[cfg(test)]
mod tests {
    use super::redact_text;

    #[test]
    fn redacts_bearer_tokens_and_assignments() {
        let redacted = redact_text(
            "authorization: Bearer abcdefghijklmnop token=secret-value password: open-sesame",
        );

        assert!(redacted.contains("authorization: ••••"));
        assert!(redacted.contains("token=••••"));
        assert!(redacted.contains("password: ••••"));
    }

    #[test]
    fn redacts_postgres_passwords_in_plain_text() {
        let redacted =
            redact_text("postgres://service:super-secret@localhost:5432/acsa?sslmode=disable");

        assert_eq!(redacted, "postgres://service:••••@localhost:5432/acsa?sslmode=disable");
    }
}
