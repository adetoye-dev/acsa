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
    env, fs,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use axum::{
    body::Bytes,
    extract::{OriginalUri, Path as AxumPath, State},
    http::{header::HeaderName, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use cron::Schedule;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use serde_yaml::Value as YamlValue;
use subtle::ConstantTimeEq;
use thiserror::Error;

use crate::{
    connectors::{discover_connector_manifests, ConnectorError},
    engine::{
        compile_workflow, load_workflows_from_dir, validate_workflow, EngineError, ExecutionStatus,
        WorkflowEngine, WorkflowPlan,
    },
    models::{Trigger, Workflow},
};

#[derive(Debug, Clone)]
pub struct TriggerServerConfig {
    pub bind_addr: SocketAddr,
    pub workflows_dir: PathBuf,
}

#[derive(Clone)]
struct AppState {
    connectors_dir: PathBuf,
    engine: WorkflowEngine,
    webhook_workflows: Arc<HashMap<String, WebhookWorkflow>>,
    workflows_dir: PathBuf,
}

#[derive(Clone)]
struct WebhookWorkflow {
    header_name: HeaderName,
    path: String,
    plan: WorkflowPlan,
    secret: String,
}

#[derive(Debug, Deserialize)]
struct CreateWorkflowRequest {
    id: Option<String>,
    yaml: String,
}

#[derive(Debug, Deserialize)]
struct DuplicateWorkflowRequest {
    target_id: String,
}

#[derive(Debug, Deserialize)]
struct RunWorkflowRequest {
    #[serde(default)]
    payload: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct SaveWorkflowRequest {
    yaml: String,
}

#[derive(Debug, Clone, Serialize)]
struct InvalidWorkflowFile {
    error: String,
    file_name: String,
    id: String,
}

#[derive(Debug, Clone, Serialize)]
struct StepTypeEntry {
    category: String,
    description: String,
    label: String,
    runtime: Option<String>,
    source: String,
    type_name: String,
}

#[derive(Debug, Clone, Serialize)]
struct TriggerTypeEntry {
    description: String,
    label: String,
    type_name: String,
}

#[derive(Debug, Clone, Serialize)]
struct WorkflowDocumentResponse {
    id: String,
    summary: WorkflowSummary,
    yaml: String,
}

#[derive(Debug, Clone, Serialize)]
struct WorkflowInventoryResponse {
    invalid_files: Vec<InvalidWorkflowFile>,
    workflows: Vec<WorkflowSummary>,
}

#[derive(Debug, Clone, Serialize)]
struct WorkflowSummary {
    description: String,
    file_name: String,
    has_connector_steps: bool,
    id: String,
    name: String,
    step_count: usize,
    trigger_type: String,
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
        .route("/api/node-catalog", get(list_node_catalog))
        .route("/api/workflows", get(list_workflows).post(create_workflow))
        .route(
            "/api/workflows/{workflow_id}",
            get(get_workflow).put(save_workflow).delete(delete_workflow),
        )
        .route("/api/workflows/{workflow_id}/duplicate", post(duplicate_workflow))
        .route("/api/workflows/{workflow_id}/run", post(run_workflow))
        .route("/human-tasks", get(list_pending_human_tasks))
        .route("/human-tasks/{task_id}/resolve", post(resolve_human_task))
        .route("/{*hook}", post(handle_webhook))
        .with_state(AppState {
            connectors_dir: PathBuf::from("connectors"),
            engine,
            webhook_workflows: Arc::new(webhook_workflows),
            workflows_dir: config.workflows_dir,
        });
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

async fn list_node_catalog(State(state): State<AppState>) -> impl IntoResponse {
    match node_catalog(&state.connectors_dir) {
        Ok((step_types, trigger_types)) => (
            StatusCode::OK,
            Json(json!({
                "step_types": step_types,
                "trigger_types": trigger_types
            })),
        ),
        Err(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
        }
    }
}

async fn list_workflows(State(state): State<AppState>) -> impl IntoResponse {
    match workflow_inventory(&state.workflows_dir) {
        Ok(inventory) => (StatusCode::OK, Json(json!(inventory))),
        Err(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
        }
    }
}

async fn get_workflow(
    State(state): State<AppState>,
    AxumPath(workflow_id): AxumPath<String>,
) -> axum::response::Response {
    match read_workflow_document(&state.workflows_dir, &workflow_id) {
        Ok(document) => (StatusCode::OK, Json(json!(document))).into_response(),
        Err(error) => workflow_error_response(error),
    }
}

async fn create_workflow(
    State(state): State<AppState>,
    Json(request): Json<CreateWorkflowRequest>,
) -> axum::response::Response {
    match create_workflow_document(&state.workflows_dir, request) {
        Ok(document) => (StatusCode::CREATED, Json(json!(document))).into_response(),
        Err(error) => workflow_error_response(error),
    }
}

async fn save_workflow(
    State(state): State<AppState>,
    AxumPath(workflow_id): AxumPath<String>,
    Json(request): Json<SaveWorkflowRequest>,
) -> axum::response::Response {
    match save_workflow_document(&state.workflows_dir, &workflow_id, &request.yaml) {
        Ok(document) => (StatusCode::OK, Json(json!(document))).into_response(),
        Err(error) => workflow_error_response(error),
    }
}

async fn delete_workflow(
    State(state): State<AppState>,
    AxumPath(workflow_id): AxumPath<String>,
) -> axum::response::Response {
    match delete_workflow_document(&state.workflows_dir, &workflow_id) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => workflow_error_response(error),
    }
}

async fn duplicate_workflow(
    State(state): State<AppState>,
    AxumPath(workflow_id): AxumPath<String>,
    Json(request): Json<DuplicateWorkflowRequest>,
) -> axum::response::Response {
    match duplicate_workflow_document(&state.workflows_dir, &workflow_id, &request.target_id) {
        Ok(document) => (StatusCode::CREATED, Json(json!(document))).into_response(),
        Err(error) => workflow_error_response(error),
    }
}

async fn run_workflow(
    State(state): State<AppState>,
    AxumPath(workflow_id): AxumPath<String>,
    Json(request): Json<RunWorkflowRequest>,
) -> axum::response::Response {
    let workflow_path = match workflow_file_path(&state.workflows_dir, &workflow_id) {
        Ok(path) => path,
        Err(error) => return workflow_error_response(error),
    };
    if !workflow_path.exists() {
        return workflow_error_response(TriggerError::WorkflowNotFound { workflow_id });
    }

    let initial_payload = json!({
        "payload": request.payload.unwrap_or_else(|| json!({})),
        "requested_at": Utc::now().to_rfc3339(),
        "source": "ui",
        "workflow_id": workflow_id
    });
    match state.engine.execute_workflow_path(&workflow_path, initial_payload).await {
        Ok(summary) => (
            StatusCode::ACCEPTED,
            Json(json!({
                "completed_steps": summary.completed_steps,
                "pending_tasks": summary.pending_tasks,
                "run_id": summary.run_id,
                "status": match summary.status {
                    ExecutionStatus::Paused => "paused",
                    ExecutionStatus::Success => "success"
                },
                "workflow_name": summary.workflow_name
            })),
        )
            .into_response(),
        Err(error) => {
            (StatusCode::BAD_REQUEST, Json(json!({ "error": error.to_string() }))).into_response()
        }
    }
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
                "pending_tasks": summary.pending_tasks,
                "run_id": summary.run_id,
                "status": match summary.status {
                    crate::engine::ExecutionStatus::Paused => "paused",
                    crate::engine::ExecutionStatus::Success => "accepted"
                },
                "workflow_name": summary.workflow_name
            })),
        ),
        Err(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
        }
    }
}

async fn list_pending_human_tasks(State(state): State<AppState>) -> impl IntoResponse {
    match state.engine.store().list_pending_human_tasks().await {
        Ok(tasks) => (
            StatusCode::OK,
            Json(json!({
                "tasks": tasks
            })),
        ),
        Err(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
        }
    }
}

async fn resolve_human_task(
    State(state): State<AppState>,
    AxumPath(task_id): AxumPath<String>,
    body: Bytes,
) -> impl IntoResponse {
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

    match state.engine.resume_human_task(&task_id, payload).await {
        Ok(summary) => (
            StatusCode::OK,
            Json(json!({
                "completed_steps": summary.completed_steps,
                "pending_tasks": summary.pending_tasks,
                "run_id": summary.run_id,
                "status": match summary.status {
                    crate::engine::ExecutionStatus::Paused => "paused",
                    crate::engine::ExecutionStatus::Success => "success"
                },
                "workflow_name": summary.workflow_name
            })),
        ),
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({ "error": error.to_string() }))),
    }
}

fn build_workflow_summary(workflow_id: String, workflow: &Workflow) -> WorkflowSummary {
    WorkflowSummary {
        description: format!(
            "{} trigger, {} step{}",
            workflow.trigger.r#type,
            workflow.steps.len(),
            if workflow.steps.len() == 1 { "" } else { "s" }
        ),
        file_name: format!("{workflow_id}.yaml"),
        has_connector_steps: workflow
            .steps
            .iter()
            .any(|step| !is_builtin_step_type(step.r#type.as_str())),
        id: workflow_id,
        name: workflow.name.clone(),
        step_count: workflow.steps.len(),
        trigger_type: workflow.trigger.r#type.clone(),
    }
}

fn create_workflow_document(
    workflows_dir: &Path,
    request: CreateWorkflowRequest,
) -> Result<WorkflowDocumentResponse, TriggerError> {
    let workflow = parse_workflow_yaml(&request.yaml)?;
    let workflow_id = request
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| slugify_workflow_name(&workflow.name));
    let workflow_path = workflow_file_path(workflows_dir, &workflow_id)?;
    if workflow_path.exists() {
        return Err(TriggerError::WorkflowAlreadyExists { workflow_id });
    }

    write_workflow_file(&workflow_path, &workflow)
}

fn delete_workflow_document(workflows_dir: &Path, workflow_id: &str) -> Result<(), TriggerError> {
    let workflow_path = workflow_file_path(workflows_dir, workflow_id)?;
    if !workflow_path.exists() {
        return Err(TriggerError::WorkflowNotFound { workflow_id: workflow_id.to_string() });
    }
    fs::remove_file(workflow_path)?;
    Ok(())
}

fn duplicate_workflow_document(
    workflows_dir: &Path,
    workflow_id: &str,
    target_id: &str,
) -> Result<WorkflowDocumentResponse, TriggerError> {
    let source_document = read_workflow_document(workflows_dir, workflow_id)?;
    let mut workflow = parse_workflow_yaml(&source_document.yaml)?;
    workflow.name = format!("{} copy", workflow.name);

    let target_path = workflow_file_path(workflows_dir, target_id)?;
    if target_path.exists() {
        return Err(TriggerError::WorkflowAlreadyExists { workflow_id: target_id.to_string() });
    }

    write_workflow_file(&target_path, &workflow)
}

fn is_builtin_step_type(type_name: &str) -> bool {
    matches!(
        type_name,
        "approval"
            | "classification"
            | "condition"
            | "constant"
            | "database_query"
            | "embedding"
            | "extraction"
            | "file_read"
            | "file_write"
            | "http_request"
            | "llm_completion"
            | "loop"
            | "manual_input"
            | "noop"
            | "parallel"
            | "retrieval"
            | "switch"
    )
}

fn node_catalog(
    connectors_dir: &Path,
) -> Result<(Vec<StepTypeEntry>, Vec<TriggerTypeEntry>), TriggerError> {
    let mut step_types = vec![
        StepTypeEntry {
            category: "core".to_string(),
            description: "Return a constant payload for downstream steps.".to_string(),
            label: "Constant".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "constant".to_string(),
        },
        StepTypeEntry {
            category: "core".to_string(),
            description: "Pass through inputs without changing workflow state.".to_string(),
            label: "Noop".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "noop".to_string(),
        },
        StepTypeEntry {
            category: "logic".to_string(),
            description: "Route execution between true and false branches.".to_string(),
            label: "Condition".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "condition".to_string(),
        },
        StepTypeEntry {
            category: "logic".to_string(),
            description: "Select one branch from multiple named options.".to_string(),
            label: "Switch".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "switch".to_string(),
        },
        StepTypeEntry {
            category: "logic".to_string(),
            description: "Iterate over a collection using the configured inner step.".to_string(),
            label: "Loop".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "loop".to_string(),
        },
        StepTypeEntry {
            category: "logic".to_string(),
            description: "Run multiple nested steps in parallel and join their outputs."
                .to_string(),
            label: "Parallel".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "parallel".to_string(),
        },
        StepTypeEntry {
            category: "integration".to_string(),
            description: "Send an HTTP request with bounded timeout and retries.".to_string(),
            label: "HTTP Request".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "http_request".to_string(),
        },
        StepTypeEntry {
            category: "integration".to_string(),
            description: "Run a database query using the configured adapter.".to_string(),
            label: "Database Query".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "database_query".to_string(),
        },
        StepTypeEntry {
            category: "integration".to_string(),
            description: "Read a file from the restricted local data directory.".to_string(),
            label: "File Read".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "file_read".to_string(),
        },
        StepTypeEntry {
            category: "integration".to_string(),
            description: "Write a file into the restricted local data directory.".to_string(),
            label: "File Write".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "file_write".to_string(),
        },
        StepTypeEntry {
            category: "ai".to_string(),
            description: "Generate a completion from an LLM provider adapter.".to_string(),
            label: "LLM Completion".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "llm_completion".to_string(),
        },
        StepTypeEntry {
            category: "ai".to_string(),
            description: "Classify a record into labels using the AI primitive.".to_string(),
            label: "Classification".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "classification".to_string(),
        },
        StepTypeEntry {
            category: "ai".to_string(),
            description: "Extract structured fields from unstructured text.".to_string(),
            label: "Extraction".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "extraction".to_string(),
        },
        StepTypeEntry {
            category: "ai".to_string(),
            description: "Store an embedding in the in-memory vector store.".to_string(),
            label: "Embedding".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "embedding".to_string(),
        },
        StepTypeEntry {
            category: "ai".to_string(),
            description: "Search the in-memory vector store for similar content.".to_string(),
            label: "Retrieval".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "retrieval".to_string(),
        },
        StepTypeEntry {
            category: "human".to_string(),
            description: "Pause execution until a reviewer approves or rejects the task."
                .to_string(),
            label: "Approval".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "approval".to_string(),
        },
        StepTypeEntry {
            category: "human".to_string(),
            description: "Pause execution until a human supplies a value.".to_string(),
            label: "Manual Input".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "manual_input".to_string(),
        },
    ];
    let mut connectors = discover_connector_manifests(connectors_dir)?
        .into_iter()
        .map(|manifest| StepTypeEntry {
            category: "connector".to_string(),
            description: format!(
                "{} connector loaded from manifest.",
                connector_runtime_name(manifest.runtime).to_uppercase()
            ),
            label: manifest.name,
            runtime: Some(connector_runtime_name(manifest.runtime).to_string()),
            source: "connector".to_string(),
            type_name: manifest.type_id,
        })
        .collect::<Vec<_>>();
    step_types.append(&mut connectors);
    step_types.sort_by(|left, right| left.label.cmp(&right.label));

    Ok((
        step_types,
        vec![
            TriggerTypeEntry {
                description: "Run workflows on demand from the editor or CLI.".to_string(),
                label: "Manual".to_string(),
                type_name: "manual".to_string(),
            },
            TriggerTypeEntry {
                description: "Schedule executions using cron expressions.".to_string(),
                label: "Cron".to_string(),
                type_name: "cron".to_string(),
            },
            TriggerTypeEntry {
                description: "Start workflows from authenticated HTTP requests.".to_string(),
                label: "Webhook".to_string(),
                type_name: "webhook".to_string(),
            },
        ],
    ))
}

fn parse_workflow_yaml(yaml: &str) -> Result<Workflow, TriggerError> {
    let workflow = serde_yaml::from_str::<Workflow>(yaml)
        .map_err(|error| TriggerError::InvalidWorkflowYaml { message: error.to_string() })?;
    validate_no_inline_secrets(&workflow)?;
    validate_workflow(&workflow)?;
    compile_workflow(workflow.clone())?;
    Ok(workflow)
}

fn read_workflow_document(
    workflows_dir: &Path,
    workflow_id: &str,
) -> Result<WorkflowDocumentResponse, TriggerError> {
    let workflow_path = workflow_file_path(workflows_dir, workflow_id)?;
    if !workflow_path.exists() {
        return Err(TriggerError::WorkflowNotFound { workflow_id: workflow_id.to_string() });
    }
    let yaml = fs::read_to_string(&workflow_path)?;
    let workflow = parse_workflow_yaml(&yaml)?;

    Ok(WorkflowDocumentResponse {
        id: workflow_id.to_string(),
        summary: build_workflow_summary(workflow_id.to_string(), &workflow),
        yaml: serialize_workflow_yaml(&workflow)?,
    })
}

fn save_workflow_document(
    workflows_dir: &Path,
    workflow_id: &str,
    yaml: &str,
) -> Result<WorkflowDocumentResponse, TriggerError> {
    let workflow_path = workflow_file_path(workflows_dir, workflow_id)?;
    let workflow = parse_workflow_yaml(yaml)?;
    write_workflow_file(&workflow_path, &workflow)
}

fn serialize_workflow_yaml(workflow: &Workflow) -> Result<String, TriggerError> {
    serde_yaml::to_string(workflow)
        .map_err(|error| TriggerError::SerializeWorkflowYaml { message: error.to_string() })
}

fn validate_no_inline_secrets(workflow: &Workflow) -> Result<(), TriggerError> {
    validate_secret_value(
        "trigger",
        &serde_yaml::to_value(&workflow.trigger)
            .map_err(|error| TriggerError::InvalidWorkflowYaml { message: error.to_string() })?,
    )?;

    for step in &workflow.steps {
        validate_secret_value(
            format!("steps.{}", step.id).as_str(),
            &serde_yaml::to_value(step).map_err(|error| TriggerError::InvalidWorkflowYaml {
                message: error.to_string(),
            })?,
        )?;
    }

    Ok(())
}

fn validate_secret_value(context: &str, value: &YamlValue) -> Result<(), TriggerError> {
    match value {
        YamlValue::Mapping(mapping) => {
            for (key, entry) in mapping {
                if let Some(key_text) = key.as_str() {
                    if looks_like_secret_key(key_text)
                        && !is_secret_reference_key(key_text)
                        && matches!(entry, YamlValue::String(secret) if !secret.trim().is_empty())
                    {
                        return Err(TriggerError::InlineSecretRejected {
                            context: context.to_string(),
                            key: key_text.to_string(),
                        });
                    }
                    let child_context = format!("{context}.{key_text}");
                    validate_secret_value(&child_context, entry)?;
                } else {
                    validate_secret_value(context, entry)?;
                }
            }
            Ok(())
        }
        YamlValue::Sequence(sequence) => {
            for entry in sequence {
                validate_secret_value(context, entry)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn looks_like_secret_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.contains("secret")
        || key.contains("token")
        || key.contains("password")
        || key.contains("credential")
        || key.contains("api_key")
        || key.contains("apikey")
}

fn is_secret_reference_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.ends_with("_env") || key == "secrets_env"
}

fn connector_runtime_name(runtime: crate::connectors::ConnectorRuntime) -> &'static str {
    match runtime {
        crate::connectors::ConnectorRuntime::Process => "process",
        crate::connectors::ConnectorRuntime::Wasm => "wasm",
    }
}

fn workflow_error_response(error: TriggerError) -> axum::response::Response {
    let status = match &error {
        TriggerError::InlineSecretRejected { .. }
        | TriggerError::InvalidWorkflowId { .. }
        | TriggerError::InvalidWorkflowYaml { .. } => StatusCode::BAD_REQUEST,
        TriggerError::WorkflowAlreadyExists { .. } => StatusCode::CONFLICT,
        TriggerError::WorkflowNotFound { .. } => StatusCode::NOT_FOUND,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };

    (status, Json(json!({ "error": error.to_string() }))).into_response()
}

fn workflow_file_path(workflows_dir: &Path, workflow_id: &str) -> Result<PathBuf, TriggerError> {
    if workflow_id.trim().is_empty()
        || workflow_id.chars().any(|character| {
            !(character.is_ascii_alphanumeric() || character == '-' || character == '_')
        })
    {
        return Err(TriggerError::InvalidWorkflowId { workflow_id: workflow_id.to_string() });
    }

    Ok(workflows_dir.join(format!("{workflow_id}.yaml")))
}

fn workflow_inventory(workflows_dir: &Path) -> Result<WorkflowInventoryResponse, TriggerError> {
    let mut entries = fs::read_dir(workflows_dir)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.path());

    let mut invalid_files = Vec::new();
    let mut workflows = Vec::new();
    for entry in entries {
        let path = entry.path();
        if !matches!(
            path.extension().and_then(|extension| extension.to_str()),
            Some("yaml" | "yml")
        ) {
            continue;
        }
        let Some(workflow_id) = path.file_stem().and_then(|stem| stem.to_str()) else {
            continue;
        };
        match fs::read_to_string(&path)
            .map_err(TriggerError::from)
            .and_then(|yaml| parse_workflow_yaml(&yaml))
        {
            Ok(workflow) => {
                workflows.push(build_workflow_summary(workflow_id.to_string(), &workflow))
            }
            Err(error) => invalid_files.push(InvalidWorkflowFile {
                error: error.to_string(),
                file_name: path
                    .file_name()
                    .and_then(|file_name| file_name.to_str())
                    .unwrap_or_default()
                    .to_string(),
                id: workflow_id.to_string(),
            }),
        }
    }

    Ok(WorkflowInventoryResponse { invalid_files, workflows })
}

fn write_workflow_file(
    workflow_path: &Path,
    workflow: &Workflow,
) -> Result<WorkflowDocumentResponse, TriggerError> {
    let yaml = serialize_workflow_yaml(workflow)?;
    fs::create_dir_all(workflow_path.parent().ok_or_else(|| {
        TriggerError::InvalidWorkflowYaml {
            message: format!("workflow path {} has no parent directory", workflow_path.display()),
        }
    })?)?;
    fs::write(workflow_path, &yaml)?;
    let workflow_id = workflow_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(|| TriggerError::InvalidWorkflowYaml {
            message: format!("workflow path {} has an invalid file name", workflow_path.display()),
        })?
        .to_string();

    Ok(WorkflowDocumentResponse {
        id: workflow_id.clone(),
        summary: build_workflow_summary(workflow_id, workflow),
        yaml,
    })
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
    #[error("connector error: {0}")]
    Connector(#[from] ConnectorError),
    #[error("workflow engine error: {0}")]
    Engine(#[from] EngineError),
    #[error("storage error: {0}")]
    Storage(#[from] crate::storage::StorageError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("workflow field {context}.{key} must reference an environment-managed secret instead of an inline value")]
    InlineSecretRejected { context: String, key: String },
    #[error("unsupported trigger type {trigger_type}")]
    UnsupportedTriggerType { trigger_type: String },
    #[error("duplicate webhook path registration: {path}")]
    DuplicateWebhookPath { path: String },
    #[error("cron trigger is missing a schedule or expression")]
    MissingCronSchedule,
    #[error("workflow id {workflow_id} contains unsupported characters")]
    InvalidWorkflowId { workflow_id: String },
    #[error("workflow YAML is invalid: {message}")]
    InvalidWorkflowYaml { message: String },
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
    #[error("failed to serialize workflow YAML: {message}")]
    SerializeWorkflowYaml { message: String },
    #[error("workflow {workflow_id} already exists")]
    WorkflowAlreadyExists { workflow_id: String },
    #[error("workflow {workflow_id} was not found")]
    WorkflowNotFound { workflow_id: String },
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use chrono::Utc;
    use serde_yaml::Value as YamlValue;

    use super::{
        cron_schedule, slugify_workflow_name, validate_secret_value, workflow_file_path,
        TriggerError,
    };
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

    #[test]
    fn rejects_inline_secret_values() {
        let value = serde_yaml::from_str::<YamlValue>(
            "headers:\n  authorization: Bearer abc\nsecret: top-secret\n",
        )
        .expect("yaml should parse");
        let error =
            validate_secret_value("trigger", &value).expect_err("inline secret should fail");

        assert!(matches!(error, TriggerError::InlineSecretRejected { .. }));
    }

    #[test]
    fn rejects_workflow_ids_with_path_traversal_characters() {
        let error = workflow_file_path(std::path::Path::new("workflows"), "../bad-id")
            .expect_err("workflow id should be rejected");

        assert!(matches!(error, TriggerError::InvalidWorkflowId { .. }));
    }
}
