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
    net::SocketAddr,
    path::PathBuf,
    sync::Arc,
    time::Duration,
};

use axum::{
    body::Bytes,
    extract::{OriginalUri, State},
    http::{header::HeaderName, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use cron::Schedule;
use serde_json::{json, Value};
use subtle::ConstantTimeEq;
use thiserror::Error;

use crate::{
    engine::{
        compile_workflow, load_workflows_from_dir, EngineError, WorkflowEngine, WorkflowPlan,
    },
    models::Trigger,
};

#[derive(Debug, Clone)]
pub struct TriggerServerConfig {
    pub bind_addr: SocketAddr,
    pub workflows_dir: PathBuf,
}

#[derive(Clone)]
struct AppState {
    engine: WorkflowEngine,
    webhook_workflows: Arc<HashMap<String, WebhookWorkflow>>,
}

#[derive(Clone)]
struct WebhookWorkflow {
    header_name: HeaderName,
    path: String,
    plan: WorkflowPlan,
    secret: String,
}

pub async fn serve(
    engine: WorkflowEngine,
    config: TriggerServerConfig,
) -> Result<(), TriggerError> {
    let workflows = load_workflows_from_dir(&config.workflows_dir)?;
    let mut webhook_workflows = HashMap::new();
    let mut registered_paths = HashSet::new();

    for workflow in workflows {
        let plan = compile_workflow(workflow)?;
        match plan.workflow.trigger.r#type.as_str() {
            "cron" => spawn_cron_trigger(engine.clone(), plan),
            "webhook" => {
                let webhook = build_webhook_workflow(plan)?;
                if !registered_paths.insert(webhook.path.clone()) {
                    return Err(TriggerError::DuplicateWebhookPath { path: webhook.path });
                }
                engine
                    .store()
                    .upsert_trigger_state(&webhook.plan.workflow.name, "webhook", None)
                    .await?;
                webhook_workflows.insert(webhook.path.clone(), webhook);
            }
            "manual" => {
                engine.store().upsert_trigger_state(&plan.workflow.name, "manual", None).await?;
            }
            other => {
                return Err(TriggerError::UnsupportedTriggerType {
                    trigger_type: other.to_string(),
                });
            }
        }
    }

    let app = Router::new()
        .route("/healthz", get(health))
        .route("/{*hook}", post(handle_webhook))
        .with_state(AppState { engine, webhook_workflows: Arc::new(webhook_workflows) });
    let listener = tokio::net::TcpListener::bind(config.bind_addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn spawn_cron_trigger(engine: WorkflowEngine, plan: WorkflowPlan) {
    tokio::spawn(async move {
        if let Err(error) = run_cron_trigger(engine, plan).await {
            eprintln!("acsa cron trigger error: {error}");
        }
    });
}

async fn run_cron_trigger(engine: WorkflowEngine, plan: WorkflowPlan) -> Result<(), TriggerError> {
    let schedule = cron_schedule(&plan.workflow.trigger)?;

    loop {
        let Some(next_run) = schedule.upcoming(Utc).next() else {
            return Err(TriggerError::EmptyCronSchedule {
                workflow_name: plan.workflow.name.clone(),
            });
        };
        engine
            .store()
            .upsert_trigger_state(&plan.workflow.name, "cron", Some(next_run.timestamp()))
            .await?;

        let wait = next_run.signed_duration_since(Utc::now()).to_std().unwrap_or(Duration::ZERO);
        tokio::time::sleep(wait).await;

        let payload = json!({
            "source": "cron",
            "scheduled_for": next_run.to_rfc3339(),
            "workflow_name": plan.workflow.name
        });
        if let Err(error) = engine.execute_plan(&plan, payload).await {
            eprintln!("acsa cron workflow '{}' failed: {error}", plan.workflow.name);
        }
    }
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

async fn handle_webhook(
    State(state): State<AppState>,
    original_uri: OriginalUri,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let path = original_uri.0.path().to_string();
    let Some(workflow) = state.webhook_workflows.get(&path).cloned() else {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "webhook not found" })));
    };

    match authenticate_webhook(&workflow, &headers) {
        Ok(()) => {}
        Err(message) => {
            return (StatusCode::UNAUTHORIZED, Json(json!({ "error": message })));
        }
    }

    let payload = if body.is_empty() {
        json!({})
    } else {
        match serde_json::from_slice::<Value>(&body) {
            Ok(value) => value,
            Err(error) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": format!("invalid JSON payload: {error}") })),
                );
            }
        }
    };

    let initial_payload = json!({
        "source": "webhook",
        "received_at": Utc::now().to_rfc3339(),
        "body": payload,
        "workflow_name": workflow.plan.workflow.name
    });
    match state.engine.execute_plan(&workflow.plan, initial_payload).await {
        Ok(summary) => (
            StatusCode::ACCEPTED,
            Json(json!({
                "run_id": summary.run_id,
                "status": "accepted",
                "workflow_name": summary.workflow_name
            })),
        ),
        Err(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
        }
    }
}

fn authenticate_webhook(workflow: &WebhookWorkflow, headers: &HeaderMap) -> Result<(), String> {
    let token = headers
        .get(&workflow.header_name)
        .ok_or_else(|| format!("missing webhook header {}", workflow.header_name.as_str()))?;
    let token_bytes = token.as_bytes();
    let expected_bytes = workflow.secret.as_bytes();
    
    // Use constant-time comparison to prevent timing attacks
    if bool::from(token_bytes.ct_eq(expected_bytes)) {
        Ok(())
    } else {
        Err("webhook token did not match".to_string())
    }
}

fn build_webhook_workflow(plan: WorkflowPlan) -> Result<WebhookWorkflow, TriggerError> {
    let trigger = &plan.workflow.trigger;
    let path = trigger_detail(trigger, "path")
        .map(str::to_string)
        .unwrap_or_else(|| format!("/hooks/{}", slugify_workflow_name(&plan.workflow.name)));
    let header_name = trigger_detail(trigger, "header")
        .unwrap_or("x-acsa-webhook-token")
        .parse::<HeaderName>()
        .map_err(|error| TriggerError::InvalidWebhookHeader {
            header: trigger_detail(trigger, "header").unwrap_or("x-acsa-webhook-token").to_string(),
            message: error.to_string(),
        })?;
    let secret_env = trigger_detail(trigger, "secret_env")
        .or_else(|| trigger_detail(trigger, "token_env"))
        .ok_or_else(|| TriggerError::MissingWebhookSecret {
            workflow_name: plan.workflow.name.clone(),
        })?;
    let secret = env::var(secret_env).map_err(|_| TriggerError::MissingWebhookSecretEnv {
        env_name: secret_env.to_string(),
        workflow_name: plan.workflow.name.clone(),
    })?;

    Ok(WebhookWorkflow { header_name, path, plan, secret })
}

fn cron_schedule(trigger: &Trigger) -> Result<Schedule, TriggerError> {
    let schedule = trigger_detail(trigger, "schedule")
        .or_else(|| trigger_detail(trigger, "expression"))
        .ok_or_else(|| TriggerError::MissingCronSchedule)?;
    schedule.parse::<Schedule>().map_err(|error| TriggerError::InvalidCronSchedule {
        schedule: schedule.to_string(),
        message: error.to_string(),
    })
}

fn trigger_detail<'a>(trigger: &'a Trigger, key: &str) -> Option<&'a str> {
    trigger.details.get(key)?.as_str()
}

fn slugify_workflow_name(name: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;

    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash && !slug.is_empty() {
            slug.push('-');
            last_was_dash = true;
        }
    }

    slug.trim_matches('-').to_string().chars().collect::<String>()
}

#[derive(Debug, Error)]
pub enum TriggerError {
    #[error("workflow engine error: {0}")]
    Engine(#[from] EngineError),
    #[error("storage error: {0}")]
    Storage(#[from] crate::storage::StorageError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("unsupported trigger type {trigger_type}")]
    UnsupportedTriggerType { trigger_type: String },
    #[error("duplicate webhook path registration: {path}")]
    DuplicateWebhookPath { path: String },
    #[error("cron trigger is missing a schedule or expression")]
    MissingCronSchedule,
    #[error("workflow {workflow_name} produced an empty cron schedule")]
    EmptyCronSchedule { workflow_name: String },
    #[error("invalid cron schedule {schedule}: {message}")]
    InvalidCronSchedule { schedule: String, message: String },
    #[error("workflow {workflow_name} is missing secret_env for its webhook trigger")]
    MissingWebhookSecret { workflow_name: String },
    #[error("workflow {workflow_name} references missing webhook secret env var {env_name}")]
    MissingWebhookSecretEnv { env_name: String, workflow_name: String },
    #[error("invalid webhook header {header}: {message}")]
    InvalidWebhookHeader { header: String, message: String },
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use chrono::Utc;
    use serde_yaml::Value as YamlValue;

    use super::{cron_schedule, slugify_workflow_name};
    use crate::models::Trigger;

    #[test]
    fn slugifies_workflow_names_for_default_webhook_paths() {
        assert_eq!(slugify_workflow_name("Customer Intake!"), "customer-intake");
    }

    #[test]
    fn parses_cron_schedules_from_trigger_details() {
        let mut details = BTreeMap::new();
        details.insert("schedule".to_string(), YamlValue::String("0 */10 * * * *".to_string()));
        let trigger = Trigger { r#type: "cron".to_string(), details };

        let schedule = cron_schedule(&trigger).expect("schedule should parse");

        assert!(schedule.upcoming(Utc).next().is_some());
    }
}
