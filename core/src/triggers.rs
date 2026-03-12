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
    collections::{BTreeMap, HashMap, HashSet},
    env, fs,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use axum::{
    body::Bytes,
    extract::{OriginalUri, Path as AxumPath, Query, State},
    http::{
        header::{HeaderName, CONTENT_TYPE},
        HeaderMap, StatusCode,
    },
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use cron::Schedule;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use serde_yaml::Value as YamlValue;
use sha2::Sha256;
use subtle::ConstantTimeEq;
use thiserror::Error;
use tracing::{error, info};

use crate::{
    connectors::{
        discover_connector_manifests, inspect_connectors, run_manifest_path, scaffold_connector,
        wasm_connectors_enabled, ConnectorError, ConnectorRuntime,
    },
    engine::{
        compile_workflow, load_workflows_from_dir, validate_workflow, EngineError, ExecutionStatus,
        WorkflowEngine, WorkflowPlan,
    },
    models::{Trigger, Workflow},
    observability::{
        current_timestamp, metrics_text, payload_visibility_enabled, record_log,
        redact_json_string, redact_text, LogLevel, RetentionPolicy,
    },
    storage::{
        LogQuery, LogRecord, PaginatedResponse, RunQuery, RunRecord, RunStore, StepRunRecord,
    },
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
    path: String,
    plan: WorkflowPlan,
    signature_auth: Option<WebhookSignatureAuth>,
    token_auth: Option<WebhookTokenAuth>,
}

#[derive(Clone)]
struct WebhookSignatureAuth {
    header_name: HeaderName,
    prefix: String,
    secret: Vec<u8>,
}

#[derive(Clone)]
struct WebhookTokenAuth {
    header_name: HeaderName,
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
struct RenameWorkflowRequest {
    name: String,
    target_id: String,
    #[serde(default)]
    yaml: Option<String>,
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

#[derive(Debug, Deserialize)]
struct CreateConnectorRequest {
    name: String,
    runtime: String,
    type_id: String,
}

#[derive(Debug, Deserialize)]
struct TestConnectorRequest {
    #[serde(default)]
    inputs: Option<Value>,
    #[serde(default)]
    params: Option<Value>,
    #[serde(default = "default_true")]
    use_sample_input: bool,
}

#[derive(Debug, Deserialize)]
struct RunLogsQuery {
    level: Option<String>,
    page: Option<usize>,
    page_size: Option<usize>,
    search: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RunsQuery {
    page: Option<usize>,
    page_size: Option<usize>,
    status: Option<String>,
    workflow_name: Option<String>,
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

#[derive(Debug, Clone)]
struct WorkflowDocumentState {
    ui_detached_steps: Vec<String>,
    ui_positions: BTreeMap<String, WorkflowNodePosition>,
    workflow: Workflow,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct WorkflowNodePosition {
    x: f64,
    y: f64,
}

#[derive(Debug, Clone, Serialize)]
struct WorkflowInventoryResponse {
    invalid_files: Vec<InvalidWorkflowFile>,
    workflows: Vec<WorkflowSummary>,
}

#[derive(Debug, Clone, Serialize)]
struct ConnectorInventoryResponse {
    connectors: Vec<ConnectorView>,
    connectors_dir: String,
    invalid_connectors: Vec<InvalidConnectorView>,
    wasm_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
struct ConnectorScaffoldResponse {
    connector: ConnectorView,
    next_steps: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ConnectorTestResponse {
    connector: ConnectorView,
    inputs: Value,
    output: Value,
    params: Value,
}

#[derive(Debug, Clone, Serialize)]
struct ConnectorView {
    allowed_env: Vec<String>,
    allowed_hosts: Vec<String>,
    connector_dir: String,
    entry: String,
    inputs: Vec<String>,
    manifest_path: String,
    name: String,
    notes: Vec<String>,
    outputs: Vec<String>,
    readme_path: Option<String>,
    runtime: String,
    runtime_ready: bool,
    runtime_status: String,
    sample_input_path: Option<String>,
    type_name: String,
    version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct InvalidConnectorView {
    connector_dir: String,
    error: String,
    id: String,
    manifest_path: Option<String>,
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

#[derive(Debug, Clone, Serialize)]
struct HumanTaskView {
    completed_at: Option<i64>,
    created_at: i64,
    details: Option<String>,
    field: Option<String>,
    id: String,
    kind: String,
    prompt: String,
    response: Option<String>,
    run_id: String,
    status: String,
    step_id: String,
    step_run_id: String,
}

#[derive(Debug, Clone, Serialize)]
struct LogPageResponse {
    logs: Vec<LogRecord>,
    page: usize,
    page_size: usize,
    total: u64,
}

#[derive(Debug, Clone, Serialize)]
struct RunDetailResponse {
    human_tasks: Vec<HumanTaskView>,
    run: RunView,
    step_runs: Vec<StepRunView>,
}

#[derive(Debug, Clone, Serialize)]
struct RunPageResponse {
    page: usize,
    page_size: usize,
    runs: Vec<RunView>,
    total: u64,
}

#[derive(Debug, Clone, Serialize)]
struct RunView {
    duration_seconds: Option<i64>,
    error_message: Option<String>,
    finished_at: Option<i64>,
    id: String,
    started_at: i64,
    status: String,
    workflow_name: String,
}

#[derive(Debug, Clone, Serialize)]
struct StepRunView {
    attempt: u32,
    duration_seconds: Option<i64>,
    error_message: Option<String>,
    finished_at: Option<i64>,
    id: String,
    input: Option<String>,
    output: Option<String>,
    started_at: i64,
    status: String,
    step_id: String,
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

    let retention_store = engine.store().clone();
    let app = Router::new()
        .route("/healthz", get(health))
        .route("/metrics", get(export_metrics))
        .route("/api/connectors", get(list_connectors))
        .route("/api/connectors/scaffold", post(create_connector))
        .route("/api/connectors/{connector_type}/test", post(test_connector))
        .route("/api/node-catalog", get(list_node_catalog))
        .route("/api/runs", get(list_runs))
        .route("/api/runs/{run_id}", get(get_run_detail))
        .route("/api/runs/{run_id}/logs", get(get_run_logs))
        .route("/api/workflows", get(list_workflows).post(create_workflow))
        .route(
            "/api/workflows/{workflow_id}",
            get(get_workflow).put(save_workflow).delete(delete_workflow),
        )
        .route("/api/workflows/{workflow_id}/duplicate", post(duplicate_workflow))
        .route("/api/workflows/{workflow_id}/rename", post(rename_workflow))
        .route("/api/workflows/{workflow_id}/run", post(run_workflow))
        .route("/api/workflows/{workflow_id}/run-async", post(run_workflow_async))
        .route("/human-tasks", get(list_pending_human_tasks))
        .route("/human-tasks/{task_id}/resolve", post(resolve_human_task))
        .route("/{*hook}", post(handle_webhook))
        .with_state(AppState {
            connectors_dir: PathBuf::from("connectors"),
            engine,
            webhook_workflows: Arc::new(webhook_workflows),
            workflows_dir: config.workflows_dir,
        });
    spawn_retention_task(retention_store);
    let listener = tokio::net::TcpListener::bind(config.bind_addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn spawn_cron_trigger(engine: WorkflowEngine, plan: WorkflowPlan) {
    tokio::spawn(async move {
        if let Err(error) = run_cron_trigger(engine, plan).await {
            tracing::error!(error = %error, "acsa cron trigger error");
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
        let _ = record_log(
            engine.store(),
            LogLevel::Info,
            None,
            None,
            format!("cron trigger fired for workflow '{}'", plan.workflow.name),
        )
        .await;
        if let Err(error) = engine.execute_plan(&plan, payload).await {
            let _ = record_log(
                engine.store(),
                LogLevel::Error,
                None,
                None,
                format!("cron workflow '{}' failed: {error}", plan.workflow.name),
            )
            .await;
            tracing::error!(workflow = %plan.workflow.name, error = %error, "acsa cron workflow failed");
        }
    }
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

async fn export_metrics(State(state): State<AppState>) -> Response {
    match state.engine.store().metrics_snapshot().await {
        Ok(snapshot) => (
            StatusCode::OK,
            [(CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")],
            metrics_text(&snapshot),
        )
            .into_response(),
        Err(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
                .into_response()
        }
    }
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

async fn list_connectors(State(state): State<AppState>) -> impl IntoResponse {
    match connector_inventory(&state.connectors_dir) {
        Ok(inventory) => (StatusCode::OK, Json(json!(inventory))),
        Err(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
        }
    }
}

async fn create_connector(
    State(state): State<AppState>,
    Json(request): Json<CreateConnectorRequest>,
) -> Response {
    let runtime = match parse_connector_runtime(&request.runtime) {
        Ok(runtime) => runtime,
        Err(error) => return connector_error_response(error),
    };

    match scaffold_connector(
        &state.connectors_dir,
        request.name.trim(),
        request.type_id.trim(),
        runtime,
    ) {
        Ok(connector_dir) => match connector_inventory(&state.connectors_dir) {
            Ok(inventory) => match inventory
                .connectors
                .into_iter()
                .find(|connector| connector.type_name == request.type_id.trim())
            {
                Some(connector) => (
                    StatusCode::CREATED,
                    Json(json!(ConnectorScaffoldResponse {
                        connector: connector.clone(),
                        next_steps: vec![
                            format!(
                                "Review {}",
                                connector.readme_path.clone().unwrap_or_else(|| connector_dir
                                    .join("README.md")
                                    .display()
                                    .to_string())
                            ),
                            format!(
                                "Run sample test with {}",
                                connector.sample_input_path.clone().unwrap_or_else(|| {
                                    connector_dir.join("sample-input.json").display().to_string()
                                })
                            ),
                        ],
                    })),
                )
                    .into_response(),
                None => connector_error_response(TriggerError::Connector(
                    ConnectorError::InvalidManifest {
                        message: "scaffolded connector could not be reloaded from inventory"
                            .to_string(),
                    },
                )),
            },
            Err(error) => connector_error_response(error),
        },
        Err(error) => connector_error_response(TriggerError::Connector(error)),
    }
}

async fn test_connector(
    State(state): State<AppState>,
    AxumPath(connector_type): AxumPath<String>,
    Json(request): Json<TestConnectorRequest>,
) -> Response {
    let inspection = match inspect_connectors(&state.connectors_dir) {
        Ok(inspection) => inspection,
        Err(error) => return connector_error_response(TriggerError::Connector(error)),
    };
    let Some(connector) = inspection
        .connectors
        .into_iter()
        .find(|connector| connector.manifest.type_id == connector_type)
    else {
        return connector_error_response(TriggerError::Connector(
            ConnectorError::InvalidManifest {
                message: format!(
                    "connector {} was not found in {}",
                    connector_type,
                    state.connectors_dir.display()
                ),
            },
        ));
    };

    let inputs = match resolve_connector_test_inputs(&connector.connector_dir, &request) {
        Ok(inputs) => inputs,
        Err(error) => return connector_error_response(error),
    };
    let params = request.params.unwrap_or_else(|| json!({}));

    match run_manifest_path(&connector.manifest_path, inputs.clone(), params.clone()).await {
        Ok(output) => (
            StatusCode::OK,
            Json(json!(ConnectorTestResponse {
                connector: connector_view(&connector),
                inputs,
                output,
                params,
            })),
        )
            .into_response(),
        Err(error) => connector_error_response(TriggerError::Connector(error)),
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

async fn list_runs(State(state): State<AppState>, Query(query): Query<RunsQuery>) -> Response {
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(12).clamp(1, 100);
    let run_query = RunQuery {
        limit: page_size,
        offset: (page - 1) * page_size,
        started_after: None,
        started_before: None,
        status: query.status,
        workflow_name: query.workflow_name,
    };

    match state.engine.store().list_runs_page(&run_query).await {
        Ok(result) => (
            StatusCode::OK,
            Json(json!(RunPageResponse {
                page,
                page_size,
                runs: result.items.into_iter().map(run_view).collect(),
                total: result.total,
            })),
        )
            .into_response(),
        Err(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
                .into_response()
        }
    }
}

async fn get_run_detail(
    State(state): State<AppState>,
    AxumPath(run_id): AxumPath<String>,
) -> Response {
    match state.engine.store().get_run_detail(&run_id).await {
        Ok((run, step_runs, human_tasks)) => (
            StatusCode::OK,
            Json(json!(RunDetailResponse {
                human_tasks: human_tasks.into_iter().map(human_task_view).collect(),
                run: run_view(run),
                step_runs: step_runs.into_iter().map(step_run_view).collect(),
            })),
        )
            .into_response(),
        Err(error) => {
            use crate::storage::StorageError;
            let (status, message) = match &error {
                StorageError::RunNotFound(_) | StorageError::HumanTaskNotFound(_) => {
                    (StatusCode::NOT_FOUND, error.to_string())
                }
                _ => (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error".to_string()),
            };
            (status, Json(json!({ "error": message }))).into_response()
        }
    }
}

async fn get_run_logs(
    State(state): State<AppState>,
    AxumPath(run_id): AxumPath<String>,
    Query(query): Query<RunLogsQuery>,
) -> Response {
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(50).clamp(1, 200);
    let log_query = LogQuery {
        level: query.level,
        limit: page_size,
        offset: (page - 1) * page_size,
        run_id: Some(run_id),
        search: query.search,
    };

    match state.engine.store().list_logs(&log_query).await {
        Ok(PaginatedResponse { items, total }) => {
            (StatusCode::OK, Json(json!(LogPageResponse { logs: items, page, page_size, total })))
                .into_response()
        }
        Err(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
                .into_response()
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

async fn rename_workflow(
    State(state): State<AppState>,
    AxumPath(workflow_id): AxumPath<String>,
    Json(request): Json<RenameWorkflowRequest>,
) -> axum::response::Response {
    match rename_workflow_document(&state.workflows_dir, &workflow_id, request) {
        Ok(document) => (StatusCode::OK, Json(json!(document))).into_response(),
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

async fn run_workflow_async(
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
    match state.engine.start_workflow_path(&workflow_path, initial_payload).await {
        Ok(started) => (
            StatusCode::ACCEPTED,
            Json(json!({
                "run_id": started.run_id,
                "status": "running",
                "workflow_name": started.workflow_name
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

    match authenticate_webhook(&workflow, &headers, &body) {
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
    let document_state = parse_workflow_document_state(&request.yaml)?;
    let workflow_id = request
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| slugify_workflow_name(&document_state.workflow.name));
    let workflow_path = workflow_file_path(workflows_dir, &workflow_id)?;
    if workflow_path.exists() {
        return Err(TriggerError::WorkflowAlreadyExists { workflow_id });
    }

    write_workflow_file(&workflow_path, &document_state)
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
    let mut document_state = parse_workflow_document_state(&source_document.yaml)?;
    document_state.workflow.name = format!("{} copy", document_state.workflow.name);

    let target_path = workflow_file_path(workflows_dir, target_id)?;
    if target_path.exists() {
        return Err(TriggerError::WorkflowAlreadyExists { workflow_id: target_id.to_string() });
    }

    write_workflow_file(&target_path, &document_state)
}

fn rename_workflow_document(
    workflows_dir: &Path,
    workflow_id: &str,
    request: RenameWorkflowRequest,
) -> Result<WorkflowDocumentResponse, TriggerError> {
    let next_name = request.name.trim();
    if next_name.is_empty() {
        return Err(TriggerError::InvalidWorkflowYaml {
            message: "workflow name must not be empty".to_string(),
        });
    }

    let mut document_state = match request.yaml.as_deref() {
        Some(yaml) => parse_workflow_document_state(yaml)?,
        None => {
            let source_document = read_workflow_document(workflows_dir, workflow_id)?;
            parse_workflow_document_state(&source_document.yaml)?
        }
    };
    document_state.workflow.name = next_name.to_string();

    let source_path = workflow_file_path(workflows_dir, workflow_id)?;
    if !source_path.exists() {
        return Err(TriggerError::WorkflowNotFound { workflow_id: workflow_id.to_string() });
    }

    let target_path = workflow_file_path(workflows_dir, &request.target_id)?;
    if request.target_id != workflow_id && target_path.exists() {
        return Err(TriggerError::WorkflowAlreadyExists { workflow_id: request.target_id });
    }

    let response = write_workflow_file(&target_path, &document_state)?;
    if source_path != target_path {
        fs::remove_file(source_path)?;
    }

    Ok(response)
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

fn connector_inventory(connectors_dir: &Path) -> Result<ConnectorInventoryResponse, TriggerError> {
    let inspection = inspect_connectors(connectors_dir)?;
    Ok(ConnectorInventoryResponse {
        connectors: inspection.connectors.iter().map(connector_view).collect(),
        connectors_dir: connectors_dir.display().to_string(),
        invalid_connectors: inspection.invalid.iter().map(invalid_connector_view).collect(),
        wasm_enabled: wasm_connectors_enabled(),
    })
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

fn connector_view(connector: &crate::connectors::DiscoveredConnector) -> ConnectorView {
    let runtime = connector_runtime_name(connector.manifest.runtime).to_string();
    let readme_path = connector.connector_dir.join("README.md");
    let sample_input_path = connector.connector_dir.join("sample-input.json");
    let runtime_ready =
        connector.manifest.runtime != ConnectorRuntime::Wasm || wasm_connectors_enabled();
    let mut notes = Vec::new();
    if connector.manifest.runtime == ConnectorRuntime::Wasm && !runtime_ready {
        notes.push("Enable ACSA_ENABLE_WASM_CONNECTORS=1 to run this connector.".to_string());
    }
    if !sample_input_path.exists() {
        notes.push("Add sample-input.json to enable one-click sample tests.".to_string());
    }
    if !readme_path.exists() {
        notes.push(
            "Add README.md so maintainers see setup and usage guidance in the repo.".to_string(),
        );
    }

    ConnectorView {
        allowed_env: connector.manifest.allowed_env.clone(),
        allowed_hosts: connector.manifest.allowed_hosts.clone(),
        connector_dir: connector.connector_dir.display().to_string(),
        entry: connector.manifest.entry.clone(),
        inputs: connector.manifest.inputs.clone(),
        manifest_path: connector.manifest_path.display().to_string(),
        name: connector.manifest.name.clone(),
        notes,
        outputs: connector.manifest.outputs.clone(),
        readme_path: readme_path.exists().then(|| readme_path.display().to_string()),
        runtime: runtime.clone(),
        runtime_ready,
        runtime_status: if runtime_ready {
            "ready".to_string()
        } else {
            "runtime_disabled".to_string()
        },
        sample_input_path: sample_input_path
            .exists()
            .then(|| sample_input_path.display().to_string()),
        type_name: connector.manifest.type_id.clone(),
        version: connector.manifest.version.clone(),
    }
}

fn invalid_connector_view(connector: &crate::connectors::InvalidConnector) -> InvalidConnectorView {
    InvalidConnectorView {
        connector_dir: connector.connector_dir.display().to_string(),
        error: connector.error.clone(),
        id: connector
            .manifest_path
            .as_ref()
            .and_then(|path| path.parent())
            .and_then(|path| path.file_name())
            .or_else(|| connector.connector_dir.file_name())
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "connector".to_string()),
        manifest_path: connector.manifest_path.as_ref().map(|path| path.display().to_string()),
    }
}

fn parse_workflow_yaml(yaml: &str) -> Result<Workflow, TriggerError> {
    let workflow = serde_yaml::from_str::<Workflow>(yaml)
        .map_err(|error| TriggerError::InvalidWorkflowYaml { message: error.to_string() })?;
    validate_no_inline_secrets(&workflow)?;
    validate_workflow(&workflow)?;
    compile_workflow(workflow.clone())?;
    Ok(workflow)
}

fn parse_workflow_document_state(yaml: &str) -> Result<WorkflowDocumentState, TriggerError> {
    let document = serde_yaml::from_str::<YamlValue>(yaml)
        .map_err(|error| TriggerError::InvalidWorkflowYaml { message: error.to_string() })?;
    let workflow = parse_workflow_yaml(yaml)?;
    Ok(WorkflowDocumentState {
        ui_detached_steps: extract_ui_detached_steps(&document)?,
        ui_positions: extract_ui_positions(&document)?,
        workflow,
    })
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
    let document_state = parse_workflow_document_state(&yaml)?;

    Ok(WorkflowDocumentResponse {
        id: workflow_id.to_string(),
        summary: build_workflow_summary(workflow_id.to_string(), &document_state.workflow),
        yaml: serialize_workflow_yaml(
            &document_state.workflow,
            &document_state.ui_positions,
            &document_state.ui_detached_steps,
        )?,
    })
}

fn save_workflow_document(
    workflows_dir: &Path,
    workflow_id: &str,
    yaml: &str,
) -> Result<WorkflowDocumentResponse, TriggerError> {
    let workflow_path = workflow_file_path(workflows_dir, workflow_id)?;
    let document_state = parse_workflow_document_state(yaml)?;
    write_workflow_file(&workflow_path, &document_state)
}

fn serialize_workflow_yaml(
    workflow: &Workflow,
    ui_positions: &BTreeMap<String, WorkflowNodePosition>,
    ui_detached_steps: &[String],
) -> Result<String, TriggerError> {
    let mut document = serde_yaml::to_value(workflow)
        .map_err(|error| TriggerError::SerializeWorkflowYaml { message: error.to_string() })?;

    if !ui_positions.is_empty() || !ui_detached_steps.is_empty() {
        insert_ui_state(&mut document, ui_positions, ui_detached_steps)?;
    }

    serde_yaml::to_string(&document)
        .map_err(|error| TriggerError::SerializeWorkflowYaml { message: error.to_string() })
}

fn extract_ui_positions(
    document: &YamlValue,
) -> Result<BTreeMap<String, WorkflowNodePosition>, TriggerError> {
    let Some(mapping) = document.as_mapping() else {
        return Ok(BTreeMap::new());
    };
    let Some(ui_value) = mapping.get(YamlValue::String("ui".to_string())) else {
        return Ok(BTreeMap::new());
    };
    let Some(ui_mapping) = ui_value.as_mapping() else {
        return Ok(BTreeMap::new());
    };
    let Some(positions_value) = ui_mapping.get(YamlValue::String("positions".to_string())) else {
        return Ok(BTreeMap::new());
    };
    let Some(positions_mapping) = positions_value.as_mapping() else {
        return Ok(BTreeMap::new());
    };

    let mut positions = BTreeMap::new();
    for (node_id, position_value) in positions_mapping {
        let Some(node_id) = node_id.as_str() else {
            continue;
        };
        let Some(position_mapping) = position_value.as_mapping() else {
            continue;
        };
        let x = yaml_number_field(position_mapping, "x", node_id)?;
        let y = yaml_number_field(position_mapping, "y", node_id)?;
        positions.insert(node_id.to_string(), WorkflowNodePosition { x, y });
    }

    Ok(positions)
}

fn extract_ui_detached_steps(document: &YamlValue) -> Result<Vec<String>, TriggerError> {
    let Some(mapping) = document.as_mapping() else {
        return Ok(Vec::new());
    };
    let Some(ui_value) = mapping.get(YamlValue::String("ui".to_string())) else {
        return Ok(Vec::new());
    };
    let Some(ui_mapping) = ui_value.as_mapping() else {
        return Ok(Vec::new());
    };
    let Some(detached_steps_value) =
        ui_mapping.get(YamlValue::String("detached_steps".to_string()))
    else {
        return Ok(Vec::new());
    };
    let Some(detached_steps_sequence) = detached_steps_value.as_sequence() else {
        return Ok(Vec::new());
    };

    let mut detached_steps = Vec::new();
    for detached_step in detached_steps_sequence {
        let Some(step_id) = detached_step.as_str() else {
            continue;
        };
        let step_id = step_id.trim();
        if step_id.is_empty() || detached_steps.iter().any(|existing| existing == step_id) {
            continue;
        }
        detached_steps.push(step_id.to_string());
    }

    Ok(detached_steps)
}

fn insert_ui_state(
    document: &mut YamlValue,
    ui_positions: &BTreeMap<String, WorkflowNodePosition>,
    ui_detached_steps: &[String],
) -> Result<(), TriggerError> {
    let Some(document_mapping) = document.as_mapping_mut() else {
        return Err(TriggerError::SerializeWorkflowYaml {
            message: "workflow document must serialize to a YAML mapping".to_string(),
        });
    };

    let mut positions_mapping = serde_yaml::Mapping::new();
    for (node_id, position) in ui_positions {
        positions_mapping.insert(
            YamlValue::String(node_id.clone()),
            serde_yaml::to_value(position).map_err(|error| {
                TriggerError::SerializeWorkflowYaml { message: error.to_string() }
            })?,
        );
    }

    let mut ui_mapping = serde_yaml::Mapping::new();
    if !ui_positions.is_empty() {
        ui_mapping.insert(
            YamlValue::String("positions".to_string()),
            YamlValue::Mapping(positions_mapping),
        );
    }
    if !ui_detached_steps.is_empty() {
        ui_mapping.insert(
            YamlValue::String("detached_steps".to_string()),
            serde_yaml::to_value(ui_detached_steps).map_err(|error| {
                TriggerError::SerializeWorkflowYaml { message: error.to_string() }
            })?,
        );
    }
    document_mapping.insert(YamlValue::String("ui".to_string()), YamlValue::Mapping(ui_mapping));
    Ok(())
}

fn yaml_number_field(
    mapping: &serde_yaml::Mapping,
    field_name: &str,
    node_id: &str,
) -> Result<f64, TriggerError> {
    let Some(value) = mapping.get(YamlValue::String(field_name.to_string())) else {
        return Err(TriggerError::InvalidWorkflowYaml {
            message: format!("node {node_id}: ui.positions.{field_name} is missing"),
        });
    };
    if let Some(f) = value.as_f64() {
        Ok(f)
    } else if let Some(i) = value.as_i64() {
        Ok(i as f64)
    } else if let Some(u) = value.as_u64() {
        Ok(u as f64)
    } else {
        Err(TriggerError::InvalidWorkflowYaml {
            message: format!("node {node_id}: ui.positions.{field_name} must be numeric"),
        })
    }
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
                    if is_secret_reference_key(key_text) {
                        continue;
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

fn resolve_connector_test_inputs(
    connector_dir: &Path,
    request: &TestConnectorRequest,
) -> Result<Value, TriggerError> {
    if let Some(inputs) = &request.inputs {
        return Ok(inputs.clone());
    }
    if !request.use_sample_input {
        return Ok(json!({}));
    }

    let sample_input_path = connector_dir.join("sample-input.json");
    if !sample_input_path.exists() {
        return Err(TriggerError::Connector(ConnectorError::InvalidManifest {
            message: format!(
                "connector test needs explicit inputs or a sample-input.json file at {}",
                sample_input_path.display()
            ),
        }));
    }

    let raw = fs::read_to_string(&sample_input_path)?;
    serde_json::from_str(&raw).map_err(|error| TriggerError::Connector(ConnectorError::Json(error)))
}

fn parse_connector_runtime(runtime: &str) -> Result<ConnectorRuntime, TriggerError> {
    match runtime {
        "process" => Ok(ConnectorRuntime::Process),
        "wasm" => Ok(ConnectorRuntime::Wasm),
        other => Err(TriggerError::Connector(ConnectorError::InvalidManifest {
            message: format!("unsupported connector runtime {other}"),
        })),
    }
}

const fn default_true() -> bool {
    true
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

fn connector_error_response(error: TriggerError) -> axum::response::Response {
    let status = match &error {
        TriggerError::Connector(ConnectorError::InvalidManifest { .. })
        | TriggerError::Connector(ConnectorError::Json(_)) => StatusCode::BAD_REQUEST,
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
    document_state: &WorkflowDocumentState,
) -> Result<WorkflowDocumentResponse, TriggerError> {
    let yaml = serialize_workflow_yaml(
        &document_state.workflow,
        &document_state.ui_positions,
        &document_state.ui_detached_steps,
    )?;
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
        summary: build_workflow_summary(workflow_id, &document_state.workflow),
        yaml,
    })
}

fn human_task_view(task: crate::storage::HumanTaskRecord) -> HumanTaskView {
    HumanTaskView {
        completed_at: task.completed_at,
        created_at: task.created_at,
        details: task.details.as_deref().map(redact_json_string),
        field: task.field,
        id: task.id,
        kind: task.kind,
        prompt: redact_text(&task.prompt),
        response: task.response.as_deref().map(redact_json_string),
        run_id: task.run_id,
        status: task.status,
        step_id: task.step_id,
        step_run_id: task.step_run_id,
    }
}

fn run_view(run: RunRecord) -> RunView {
    RunView {
        duration_seconds: run
            .finished_at
            .map(|finished_at| finished_at.saturating_sub(run.started_at)),
        error_message: run.error_message.map(|message| redact_text(&message)),
        finished_at: run.finished_at,
        id: run.id,
        started_at: run.started_at,
        status: run.status,
        workflow_name: run.workflow_name,
    }
}

fn step_run_view(step_run: StepRunRecord) -> StepRunView {
    StepRunView {
        attempt: step_run.attempt,
        duration_seconds: step_run
            .finished_at
            .map(|finished_at| finished_at.saturating_sub(step_run.started_at)),
        error_message: step_run.error_message.map(|message| redact_text(&message)),
        finished_at: step_run.finished_at,
        id: step_run.id,
        input: if payload_visibility_enabled() {
            step_run.input.as_deref().map(redact_json_string)
        } else {
            None
        },
        output: if payload_visibility_enabled() {
            step_run.output.as_deref().map(redact_json_string)
        } else {
            None
        },
        started_at: step_run.started_at,
        status: step_run.status,
        step_id: step_run.step_id,
    }
}

fn spawn_retention_task(store: RunStore) {
    let Some(policy) = RetentionPolicy::from_env() else {
        return;
    };

    tokio::spawn(async move {
        loop {
            let now = current_timestamp();
            match store
                .purge_history(policy.run_cutoff_timestamp(now), policy.log_cutoff_timestamp(now))
                .await
            {
                Ok(summary) if summary.purged_logs > 0 || summary.purged_runs > 0 => {
                    info!(
                        purged_logs = summary.purged_logs,
                        purged_runs = summary.purged_runs,
                        "acsa retention cleanup removed old observability records"
                    );
                }
                Ok(_) => {}
                Err(cleanup_error) => {
                    error!(error = %cleanup_error, "acsa retention cleanup failed");
                }
            }

            tokio::time::sleep(Duration::from_secs(60 * 60)).await;
        }
    });
}

fn authenticate_webhook(
    workflow: &WebhookWorkflow,
    headers: &HeaderMap,
    body: &[u8],
) -> Result<(), String> {
    if let Some(token_auth) = &workflow.token_auth {
        let token = headers
            .get(&token_auth.header_name)
            .ok_or_else(|| format!("missing webhook header {}", token_auth.header_name.as_str()))?;
        if !bool::from(token.as_bytes().ct_eq(token_auth.secret.as_bytes())) {
            return Err("webhook token did not match".to_string());
        }
    }

    if let Some(signature_auth) = &workflow.signature_auth {
        let signature = headers.get(&signature_auth.header_name).ok_or_else(|| {
            format!("missing webhook signature header {}", signature_auth.header_name.as_str())
        })?;
        let actual = signature
            .to_str()
            .map_err(|_| "webhook signature header must be valid ASCII".to_string())?
            .trim()
            .to_ascii_lowercase();
        let expected = compute_signature(body, &signature_auth.secret, &signature_auth.prefix);
        if !bool::from(actual.as_bytes().ct_eq(expected.as_bytes())) {
            return Err("webhook signature did not match".to_string());
        }
    }

    Ok(())
}

fn build_webhook_workflow(plan: WorkflowPlan) -> Result<WebhookWorkflow, TriggerError> {
    let trigger = &plan.workflow.trigger;
    let path = trigger_detail(trigger, "path")
        .map(str::to_string)
        .unwrap_or_else(|| format!("/hooks/{}", slugify_workflow_name(&plan.workflow.name)));
    let token_auth = match trigger_detail(trigger, "secret_env")
        .or_else(|| trigger_detail(trigger, "token_env"))
    {
        Some(secret_env) => {
            let header_name = trigger_detail(trigger, "header")
                .unwrap_or("x-acsa-webhook-token")
                .parse::<HeaderName>()
                .map_err(|error| TriggerError::InvalidWebhookHeader {
                    header: trigger_detail(trigger, "header")
                        .unwrap_or("x-acsa-webhook-token")
                        .to_string(),
                    message: error.to_string(),
                })?;
            let secret =
                env::var(secret_env).map_err(|_| TriggerError::MissingWebhookSecretEnv {
                    env_name: secret_env.to_string(),
                    workflow_name: plan.workflow.name.clone(),
                })?;
            Some(WebhookTokenAuth { header_name, secret })
        }
        None => None,
    };
    let signature_auth = match trigger_detail(trigger, "signature_env") {
        Some(secret_env) => {
            let header_name = trigger_detail(trigger, "signature_header")
                .unwrap_or("x-acsa-signature")
                .parse::<HeaderName>()
                .map_err(|error| TriggerError::InvalidWebhookHeader {
                    header: trigger_detail(trigger, "signature_header")
                        .unwrap_or("x-acsa-signature")
                        .to_string(),
                    message: error.to_string(),
                })?;
            let secret =
                env::var(secret_env).map_err(|_| TriggerError::MissingWebhookSecretEnv {
                    env_name: secret_env.to_string(),
                    workflow_name: plan.workflow.name.clone(),
                })?;
            Some(WebhookSignatureAuth {
                header_name,
                prefix: trigger_detail(trigger, "signature_prefix")
                    .unwrap_or("sha256=")
                    .to_string(),
                secret: secret.into_bytes(),
            })
        }
        None => None,
    };

    if token_auth.is_none() && signature_auth.is_none() {
        return Err(TriggerError::MissingWebhookAuthentication {
            workflow_name: plan.workflow.name.clone(),
        });
    }

    Ok(WebhookWorkflow { path, plan, signature_auth, token_auth })
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

fn compute_signature(body: &[u8], secret: &[u8], prefix: &str) -> String {
    type HmacSha256 = Hmac<Sha256>;

    let mut mac = HmacSha256::new_from_slice(secret).expect("hmac accepts arbitrary key sizes");
    mac.update(body);
    let digest = mac.finalize().into_bytes();
    let mut rendered = String::with_capacity(prefix.len() + (digest.len() * 2));
    rendered.push_str(prefix);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(rendered, "{byte:02x}");
    }
    rendered
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
    #[error("workflow {workflow_name} must configure secret_env/token_env and/or signature_env for its webhook trigger")]
    MissingWebhookAuthentication { workflow_name: String },
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

    use axum::http::{HeaderMap, HeaderValue};
    use chrono::Utc;
    use serde_json::json;
    use serde_yaml::Value as YamlValue;

    use super::{
        authenticate_webhook, compute_signature, cron_schedule, parse_workflow_document_state,
        rename_workflow_document, serialize_workflow_yaml, slugify_workflow_name,
        validate_secret_value, workflow_file_path, RenameWorkflowRequest, TriggerError,
        WebhookSignatureAuth, WebhookWorkflow,
    };
    use crate::{
        engine::compile_workflow,
        models::{Step, Trigger, Workflow},
    };

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
    fn allows_secrets_env_mappings() {
        let value =
            serde_yaml::from_str::<YamlValue>("secrets_env:\n  password: ACSA_SMTP_PASSWORD\n")
                .expect("yaml should parse");

        validate_secret_value("steps.send_brief_email.params", &value)
            .expect("secrets_env should be treated as an environment reference map");
    }

    #[test]
    fn rejects_workflow_ids_with_path_traversal_characters() {
        let error = workflow_file_path(std::path::Path::new("workflows"), "../bad-id")
            .expect_err("workflow id should be rejected");

        assert!(matches!(error, TriggerError::InvalidWorkflowId { .. }));
    }

    #[test]
    fn authenticates_signed_webhooks() {
        let webhook = signed_webhook("phase10-secret");
        let body = br#"{"ok":true}"#;
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-acsa-signature",
            HeaderValue::from_str(&compute_signature(body, b"phase10-secret", "sha256="))
                .expect("signature should be valid"),
        );

        let result = authenticate_webhook(&webhook, &headers, body);

        assert!(result.is_ok());
    }

    #[test]
    fn rejects_incorrect_webhook_signatures() {
        let webhook = signed_webhook("phase10-secret");
        let body = br#"{"ok":true}"#;
        let mut headers = HeaderMap::new();
        headers.insert("x-acsa-signature", HeaderValue::from_static("sha256=deadbeef"));

        let result = authenticate_webhook(&webhook, &headers, body);

        assert!(matches!(result, Err(message) if message == "webhook signature did not match"));
    }

    #[test]
    fn parses_ui_positions_without_affecting_workflow_validation() {
        let document_state = parse_workflow_document_state(
            r#"
version: v1
name: layout-demo
trigger:
  type: manual
steps:
  - id: start
    type: constant
    params:
      value: true
    next: []
ui:
  positions:
    __trigger__:
      x: 80
      y: 200
    start:
      x: 340
      y: 120
"#,
        )
        .expect("document state should parse");

        assert_eq!(document_state.workflow.name, "layout-demo");
        assert_eq!(document_state.ui_positions.len(), 2);
        assert_eq!(document_state.ui_positions["start"].x, 340.0);
    }

    #[test]
    fn serializes_ui_positions_back_into_workflow_yaml() {
        let document_state = parse_workflow_document_state(
            r#"
version: v1
name: layout-demo
trigger:
  type: manual
steps:
  - id: start
    type: constant
    params:
      value: true
    next: []
ui:
  positions:
    start:
      x: 512
      y: 192
"#,
        )
        .expect("document state should parse");

        let yaml = serialize_workflow_yaml(
            &document_state.workflow,
            &document_state.ui_positions,
            &document_state.ui_detached_steps,
        )
        .expect("workflow yaml should serialize");

        assert!(yaml.contains("ui:"));
        assert!(yaml.contains("positions:"));
        assert!(yaml.contains("start:"));
        assert!(yaml.contains("x: 512.0"));
    }

    #[test]
    fn preserves_detached_steps_in_workflow_ui_state() {
        let document_state = parse_workflow_document_state(
            r#"
version: v1
name: detached-demo
trigger:
  type: manual
steps:
  - id: start
    type: constant
    params:
      value: true
    next: []
ui:
  detached_steps:
    - start
"#,
        )
        .expect("document state should parse");

        assert_eq!(document_state.ui_detached_steps, vec!["start".to_string()]);

        let yaml = serialize_workflow_yaml(
            &document_state.workflow,
            &document_state.ui_positions,
            &document_state.ui_detached_steps,
        )
        .expect("workflow yaml should serialize");

        assert!(yaml.contains("detached_steps:"));
        assert!(yaml.contains("- start"));
    }

    #[test]
    fn renames_workflow_file_and_name_together() {
        let temp_dir = write_temp_directory("rename");
        let workflow_path = temp_dir.join("draft.yaml");
        std::fs::write(
            &workflow_path,
            r#"
version: v1
name: draft
trigger:
  type: manual
steps:
  - id: first
    type: constant
    params:
      value: 1
    next: []
"#,
        )
        .expect("workflow should be written");

        let response = rename_workflow_document(
            &temp_dir,
            "draft",
            RenameWorkflowRequest {
                name: "Customer intake".to_string(),
                target_id: "customer-intake".to_string(),
                yaml: None,
            },
        )
        .expect("rename should succeed");

        assert_eq!(response.id, "customer-intake");
        assert_eq!(response.summary.file_name, "customer-intake.yaml");
        assert_eq!(response.summary.name, "Customer intake");
        assert!(!workflow_path.exists());
        let renamed_yaml = std::fs::read_to_string(temp_dir.join("customer-intake.yaml"))
            .expect("renamed workflow should exist");
        assert!(renamed_yaml.contains("name: Customer intake"));

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn rename_uses_supplied_yaml_when_present() {
        let temp_dir = write_temp_directory("rename-yaml");
        let workflow_path = temp_dir.join("draft.yaml");
        std::fs::write(
            &workflow_path,
            r#"
version: v1
name: original
trigger:
  type: manual
steps:
  - id: first
    type: constant
    params:
      value: 1
    next: []
"#,
        )
        .expect("workflow should be written");

        let response = rename_workflow_document(
            &temp_dir,
            "draft",
            RenameWorkflowRequest {
                name: "Updated draft".to_string(),
                target_id: "updated-draft".to_string(),
                yaml: Some(
                    r#"
version: v1
name: ignored
trigger:
  type: manual
steps:
  - id: first
    type: constant
    params:
      value: 99
    next: []
"#
                    .to_string(),
                ),
            },
        )
        .expect("rename should succeed");

        assert_eq!(response.summary.name, "Updated draft");
        assert!(response.yaml.contains("value: 99"));

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    fn signed_webhook(secret: &str) -> WebhookWorkflow {
        let plan = compile_workflow(Workflow {
            version: "v1".to_string(),
            name: "signed-webhook".to_string(),
            trigger: Trigger { r#type: "manual".to_string(), details: BTreeMap::new() },
            steps: vec![Step {
                id: "start".to_string(),
                r#type: "constant".to_string(),
                params: serde_yaml::to_value(json!({ "value": true }))
                    .expect("json should convert to yaml"),
                next: vec![],
                retry: None,
                timeout_ms: None,
            }],
            ui: Default::default(),
        })
        .expect("workflow plan should compile");

        WebhookWorkflow {
            path: "/hooks/signed-webhook".to_string(),
            plan,
            signature_auth: Some(WebhookSignatureAuth {
                header_name: "x-acsa-signature".parse().expect("header should parse"),
                prefix: "sha256=".to_string(),
                secret: secret.as_bytes().to_vec(),
            }),
            token_auth: None,
        }
    }

    fn write_temp_directory(prefix: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "acsa-trigger-tests-{prefix}-{}",
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(&dir).expect("temp directory should be created");
        dir
    }
}
