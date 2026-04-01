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
    extract::{ConnectInfo, OriginalUri, Path as AxumPath, Query, State},
    http::{
        header::{HeaderName, AUTHORIZATION, CONTENT_TYPE},
        HeaderMap, Request, StatusCode,
    },
    middleware::{self, Next},
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
use tracing::{error, info, warn};

use crate::{
    asset_store::AssetStore,
    connectors::{
        discover_connector_manifests_from_dirs, inspect_connectors, inspect_connectors_from_dirs,
        install_starter_connector_pack, run_manifest_path, scaffold_connector,
        wasm_connectors_enabled, ConnectorError, ConnectorManifest, ConnectorRuntime,
    },
    engine::{
        compile_workflow, load_workflows_from_dir, validate_workflow, EngineError, ExecutionStatus,
        WorkflowEngine, WorkflowPlan,
    },
    models::{Trigger, Workflow},
    n8n_import::translate_n8n_workflow,
    nodes::AliasNodeDefinition,
    observability::{
        current_timestamp, metrics_text, payload_visibility_enabled, record_log,
        redact_json_string, redact_text, LogLevel, RetentionPolicy,
    },
    product_state::{
        connector_state, invalid_connector_state, latest_workflow_telemetry, run_provenance,
        workflow_connector_requirements, workflow_state_from_facts,
        ConnectorState as ProductConnectorState, ConnectorTrustState as ProductConnectorTrustState,
        RunProvenance as ProductRunProvenance, WorkflowConnectorRequirementsState, WorkflowFacts,
        WorkflowLifecycleState, WorkflowState as ProductWorkflowState, WorkflowTelemetryFacts,
        WorkflowValidationState,
    },
    storage::{
        resolve_secret_value, AssetRecord, CredentialRecord, LogQuery, LogRecord, NewAssetRecord,
        NewConnectorRecord, NewNodeRecord, PaginatedResponse, RunQuery, RunRecord, RunStore,
        StepRunRecord, StorageError, WorkflowRecord,
    },
};

#[derive(Debug, Clone)]
pub struct TriggerServerConfig {
    pub bind_addr: SocketAddr,
    pub workflows_dir: PathBuf,
}

#[derive(Clone)]
struct AppState {
    access_control: EngineAccessControl,
    connectors_dir: PathBuf,
    engine: WorkflowEngine,
    webhook_workflows: Arc<HashMap<String, WebhookWorkflow>>,
    workflows_dir: PathBuf,
}

#[derive(Clone)]
struct EngineAccessControl {
    allow_remote: bool,
    auth_token: Option<String>,
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
struct N8nImportRequest {
    workflow_json: Value,
}

#[derive(Debug, Deserialize)]
struct UpsertCredentialRequest {
    name: String,
    value: String,
}

#[derive(Debug)]
struct WorkflowWriteResult {
    id: String,
    yaml: String,
}

#[derive(Debug, Deserialize)]
struct CreateConnectorRequest {
    name: String,
    runtime: String,
    type_id: String,
}

#[derive(Debug, Deserialize)]
struct UpdateConnectorRecordRequest {
    description: String,
    name: String,
}

#[derive(Debug, Deserialize)]
struct UpsertNodeRecordRequest {
    #[serde(default)]
    base_type_name: Option<String>,
    category: String,
    description: String,
    label: String,
    source_kind: String,
    #[serde(default)]
    source_ref: Option<String>,
    type_name: String,
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
    app_record: Option<NodeRecordView>,
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
    invalid_connectors: Vec<InvalidConnectorView>,
    wasm_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
struct StarterConnectorPackView {
    description: String,
    id: String,
    install_state: String,
    installed: bool,
    name: String,
    provided_step_types: Vec<String>,
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
struct NodeRecordResponse {
    base_type_name: Option<String>,
    category: String,
    description: String,
    id: String,
    label: String,
    source_kind: String,
    source_ref: Option<String>,
    type_name: String,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
struct CredentialView {
    is_overridden_by_env: bool,
    name: String,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
struct CredentialsResponse {
    credentials: Vec<CredentialView>,
}

#[derive(Debug, Clone, Serialize)]
struct ConnectorView {
    allowed_env: Vec<String>,
    allowed_hosts: Vec<String>,
    app_record: Option<ConnectorRecordView>,
    connector_dir: String,
    connector_state: ProductConnectorState,
    description: String,
    entry: String,
    inputs: Vec<String>,
    manifest_path: String,
    name: String,
    notes: Vec<String>,
    outputs: Vec<String>,
    readme_path: Option<String>,
    required_by_templates: Vec<String>,
    runtime: String,
    runtime_ready: bool,
    runtime_status: String,
    sample_input_path: Option<String>,
    provided_step_types: Vec<String>,
    type_name: String,
    used_by_workflows: Vec<String>,
    version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct InvalidConnectorView {
    app_record: Option<ConnectorRecordView>,
    connector_dir: String,
    connector_state: ProductConnectorState,
    error: String,
    id: String,
    manifest_path: Option<String>,
    provided_step_types: Vec<String>,
    required_by_templates: Vec<String>,
    used_by_workflows: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ConnectorRecordView {
    available_version: Option<String>,
    description: Option<String>,
    installed_version: Option<String>,
    is_locally_modified: bool,
    name: Option<String>,
    source_kind: String,
    source_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct NodeRecordView {
    base_type_name: Option<String>,
    source_kind: String,
    source_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct WorkflowSummary {
    description: String,
    file_name: String,
    has_connector_steps: bool,
    id: String,
    name: String,
    workflow_state: ProductWorkflowState,
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
    editor_snapshot: Option<String>,
    human_tasks: Vec<HumanTaskView>,
    run: RunView,
    step_runs: Vec<StepRunView>,
    workflow_snapshot: Option<String>,
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
    run_provenance: ProductRunProvenance,
    started_at: i64,
    status: String,
    workflow_revision: Option<String>,
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
    let access_control = EngineAccessControl::from_env();
    if !config.bind_addr.ip().is_loopback() && !access_control.allow_remote {
        return Err(TriggerError::RemoteBindingRequiresExplicitOptIn {
            bind_addr: config.bind_addr,
        });
    }

    if !config.bind_addr.ip().is_loopback()
        && access_control.allow_remote
        && access_control.auth_token.is_none()
    {
        tracing::warn!(
            bind_addr = %config.bind_addr,
            "remote engine access enabled without ACSA_ENGINE_AUTH_TOKEN"
        );
    }

    seed_workflows_from_directory_if_missing(engine.store(), &config.workflows_dir).await?;
    ensure_shipped_asset_records(engine.store()).await?;
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
    let state = AppState {
        access_control,
        connectors_dir: PathBuf::from("connectors"),
        engine,
        webhook_workflows: Arc::new(webhook_workflows),
        workflows_dir: config.workflows_dir,
    };
    let protected_routes = Router::new()
        .route("/metrics", get(export_metrics))
        .route("/api/credentials", get(list_credentials).post(upsert_credential))
        .route("/api/credentials/{credential_name}", axum::routing::delete(delete_credential))
        .route("/api/connectors", get(list_connectors))
        .route("/api/connectors/starter-packs", get(list_starter_connector_packs))
        .route(
            "/api/connectors/starter-packs/{pack_id}/install",
            post(install_starter_connector_pack_endpoint),
        )
        .route("/api/connectors/scaffold", post(create_connector))
        .route("/api/connectors/{connector_type}", axum::routing::put(update_connector_record))
        .route("/api/node-records", get(list_node_records).post(upsert_node_record))
        .route("/api/connectors/{connector_type}/test", post(test_connector))
        .route("/api/imports/n8n", post(import_n8n_workflow))
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
        .route_layer(middleware::from_fn_with_state(state.clone(), enforce_engine_access));
    let app = Router::new()
        .route("/healthz", get(health))
        .merge(protected_routes)
        .route("/{*hook}", post(handle_webhook))
        .with_state(state);
    spawn_retention_task(retention_store);
    let listener = tokio::net::TcpListener::bind(config.bind_addr).await?;
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;
    Ok(())
}

impl EngineAccessControl {
    fn from_env() -> Self {
        Self {
            allow_remote: env_flag("ACSA_ALLOW_REMOTE_ENGINE"),
            auth_token: env::var("ACSA_ENGINE_AUTH_TOKEN")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
        }
    }
}

async fn enforce_engine_access(
    State(state): State<AppState>,
    ConnectInfo(remote_addr): ConnectInfo<SocketAddr>,
    request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    if remote_addr.ip().is_loopback() {
        return next.run(request).await;
    }

    if !state.access_control.allow_remote {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "remote engine access is disabled; bind to loopback or set ACSA_ALLOW_REMOTE_ENGINE=1"
            })),
        )
            .into_response();
    }

    if let Some(expected_token) = &state.access_control.auth_token {
        if request_has_engine_token(request.headers(), expected_token) {
            return next.run(request).await;
        }

        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "error": "missing or invalid engine auth token"
            })),
        )
            .into_response();
    }

    next.run(request).await
}

fn request_has_engine_token(headers: &HeaderMap, expected_token: &str) -> bool {
    headers
        .get("x-acsa-engine-token")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some_and(|token| bool::from(token.as_bytes().ct_eq(expected_token.as_bytes())))
        || headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.trim().strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some_and(|token| bool::from(token.as_bytes().ct_eq(expected_token.as_bytes())))
}

fn env_flag(name: &str) -> bool {
    matches!(
        env::var(name).ok().as_deref(),
        Some("1" | "true" | "TRUE" | "True" | "yes" | "YES" | "Yes" | "on" | "ON" | "On")
    )
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
    match node_catalog(state.engine.store(), &state.connectors_dir).await {
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
    match connector_inventory(state.engine.store(), &state.connectors_dir).await {
        Ok(inventory) => (StatusCode::OK, Json(json!(inventory))),
        Err(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
        }
    }
}

async fn list_starter_connector_packs(State(state): State<AppState>) -> impl IntoResponse {
    if let Err(error) = ensure_shipped_asset_records(state.engine.store()).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })));
    }

    match starter_connector_pack_views(state.engine.store(), &state.connectors_dir).await {
        Ok(views) => (StatusCode::OK, Json(json!(views))),
        Err(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
        }
    }
}

async fn list_node_records(State(state): State<AppState>) -> impl IntoResponse {
    let node_asset_base_types = match node_asset_base_type_map(state.engine.store()).await {
        Ok(base_types) => base_types,
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": error.to_string() })),
            );
        }
    };

    match state.engine.store().list_node_records().await {
        Ok(records) => (
            StatusCode::OK,
            Json(json!(records
                .into_iter()
                .map(|record| {
                    let base_type_name = node_asset_base_types.get(&record.type_name).cloned();
                    node_record_response(record, base_type_name)
                })
                .collect::<Vec<_>>())),
        ),
        Err(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
        }
    }
}

async fn install_starter_connector_pack_endpoint(
    State(state): State<AppState>,
    AxumPath(pack_id): AxumPath<String>,
) -> Response {
    let pack = match crate::starter_connector_packs::starter_connector_pack(&pack_id) {
        Ok(Some(pack)) => pack,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("starter pack {} not found", pack_id) })),
            )
                .into_response();
        }
        Err(error) => return connector_error_response(TriggerError::StarterPack(error)),
    };

    let asset_store = match AssetStore::new(state.engine.store().asset_store_root()) {
        Ok(asset_store) => asset_store,
        Err(error) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
                .into_response()
        }
    };
    let install_root = asset_store.connectors_dir();

    match install_starter_connector_pack(&install_root, &pack) {
        Ok(_) => {
            if let Err(error) = persist_connector_record_from_dir(
                state.engine.store(),
                &install_root,
                &install_root.join(pack.install_dir_name),
                "starter_pack",
                Some(pack.id),
            )
            .await
            {
                return connector_error_response(error);
            }
            let pack_states =
                match starter_pack_install_state_map(state.engine.store(), &state.connectors_dir)
                    .await
                {
                    Ok(states) => states,
                    Err(error) => {
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({ "error": error.to_string() })),
                        )
                            .into_response();
                    }
                };
            let view = starter_connector_pack_view(&pack, pack_states.get(pack.install_dir_name));
            (StatusCode::OK, Json(json!(view))).into_response()
        }
        Err(error) => connector_error_response(TriggerError::Connector(error)),
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

    let asset_store = match AssetStore::new(state.engine.store().asset_store_root()) {
        Ok(asset_store) => asset_store,
        Err(error) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
                .into_response()
        }
    };
    let install_root = asset_store.connectors_dir();

    match scaffold_connector(&install_root, request.name.trim(), request.type_id.trim(), runtime) {
        Ok(connector_dir) => {
            if let Err(error) = persist_connector_record_from_dir(
                state.engine.store(),
                &install_root,
                &connector_dir,
                "custom",
                None,
            )
            .await
            {
                return connector_error_response(error);
            }
            match connector_inventory(state.engine.store(), &state.connectors_dir).await {
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
                                format!("Open {} in Connectors", connector.name),
                                if connector.sample_input_path.is_some() {
                                    format!("Run a sample test for {}", connector.name)
                                } else {
                                    format!("Add a sample test input for {}", connector.name)
                                },
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
            }
        }
        Err(error) => connector_error_response(TriggerError::Connector(error)),
    }
}

async fn update_connector_record(
    State(state): State<AppState>,
    AxumPath(connector_type): AxumPath<String>,
    Json(request): Json<UpdateConnectorRecordRequest>,
) -> Response {
    let name = request.name.trim();
    let description = request.description.trim();
    if name.is_empty() || description.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "connector name and description are required" })),
        )
            .into_response();
    }

    let store = state.engine.store();
    let connector_asset = match store.get_asset_record("connector", &connector_type).await {
        Ok(record) => record,
        Err(StorageError::AssetRecordNotFound(_, _)) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("connector {} was not found", connector_type) })),
            )
                .into_response();
        }
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response();
        }
    };

    if let Err(error) = store
        .upsert_asset_record(NewAssetRecord {
            asset_kind: "connector",
            type_name: &connector_asset.type_name,
            name,
            description,
            category: connector_asset.category.as_deref(),
            runtime: connector_asset.runtime.as_deref(),
            source_kind: &connector_asset.source_kind,
            source_ref: connector_asset.source_ref.as_deref(),
            definition_json: &connector_asset.definition_json,
            installed_version: connector_asset.installed_version.as_deref(),
            available_version: connector_asset.available_version.as_deref(),
            is_locally_modified: true,
        })
        .await
    {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
            .into_response();
    }

    match store.get_connector_record_by_type(&connector_type).await {
        Ok(record) => {
            if let Err(error) = store
                .upsert_connector_record(NewConnectorRecord {
                    type_name: &record.type_name,
                    name,
                    runtime: &record.runtime,
                    source_kind: &record.source_kind,
                    source_ref: record.source_ref.as_deref(),
                    connector_dir: &record.connector_dir,
                    manifest_path: &record.manifest_path,
                    manifest_json: &record.manifest_json,
                })
                .await
            {
                if let Err(rollback_error) = store
                    .upsert_asset_record(NewAssetRecord {
                        asset_kind: "connector",
                        type_name: &connector_asset.type_name,
                        name: &connector_asset.name,
                        description: &connector_asset.description,
                        category: connector_asset.category.as_deref(),
                        runtime: connector_asset.runtime.as_deref(),
                        source_kind: &connector_asset.source_kind,
                        source_ref: connector_asset.source_ref.as_deref(),
                        definition_json: &connector_asset.definition_json,
                        installed_version: connector_asset.installed_version.as_deref(),
                        available_version: connector_asset.available_version.as_deref(),
                        is_locally_modified: connector_asset.is_locally_modified,
                    })
                    .await
                {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({
                            "error": format!(
                                "{} (asset rollback failed: {})",
                                error,
                                rollback_error
                            )
                        })),
                    )
                        .into_response();
                }
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": error.to_string() })),
                )
                    .into_response();
            }
        }
        Err(StorageError::ConnectorRecordNotFound(_)) => {}
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response();
        }
    }

    (
        StatusCode::OK,
        Json(json!({
            "type_name": connector_type,
            "name": name,
            "description": description,
            "is_locally_modified": true
        })),
    )
        .into_response()
}

async fn upsert_node_record(
    State(state): State<AppState>,
    Json(request): Json<UpsertNodeRecordRequest>,
) -> Response {
    let store = state.engine.store();
    let type_name = request.type_name.trim();
    let label = request.label.trim();
    let description = request.description.trim();
    let category = request.category.trim();
    let source_kind = request.source_kind.trim();
    let source_ref = request.source_ref.as_deref().map(str::trim);
    let base_type_name = request
        .base_type_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("noop");

    let node_record =
        NewNodeRecord { type_name, label, description, category, source_kind, source_ref };
    let node_record_existed = match store.get_node_record_by_type(type_name).await {
        Ok(_) => true,
        Err(StorageError::NodeRecordNotFound(_)) => false,
        Err(error) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
                .into_response()
        }
    };

    match store.upsert_node_record(node_record).await {
        Ok(record) => match upsert_node_asset_record(store, &node_record, base_type_name).await {
            Ok(()) => (
                StatusCode::OK,
                Json(json!(node_record_response(record, Some(base_type_name.to_string())))),
            )
                .into_response(),
            Err(error) => {
                if !node_record_existed {
                    if let Err(rollback_error) = store.delete_node_record(&record.id).await {
                        error!(
                            node_record_id = %record.id,
                            rollback_error = %rollback_error,
                            "failed to rollback inserted node record after node asset upsert failure"
                        );
                    }
                }
                (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
                    .into_response()
            }
        },
        Err(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
                .into_response()
        }
    }
}

async fn upsert_node_asset_record(
    store: &RunStore,
    node_record: &NewNodeRecord<'_>,
    base_type_name: &str,
) -> Result<(), TriggerError> {
    let definition_json = serde_json::to_string(&json!({
        "kind": "alias",
        "base_type": base_type_name,
        "default_params": {}
    }))
    .map_err(|error| TriggerError::Engine(EngineError::ConnectorLoad(error.to_string())))?;

    let record = NewAssetRecord {
        asset_kind: "node",
        type_name: node_record.type_name,
        name: node_record.label,
        description: node_record.description,
        category: Some(node_record.category),
        runtime: Some("alias"),
        source_kind: node_record.source_kind,
        source_ref: node_record.source_ref,
        definition_json: &definition_json,
        installed_version: None,
        available_version: None,
        is_locally_modified: false,
    };

    store.upsert_asset_record(record).await?;

    Ok(())
}

async fn test_connector(
    State(state): State<AppState>,
    AxumPath(connector_type): AxumPath<String>,
    Json(request): Json<TestConnectorRequest>,
) -> Response {
    let asset_store_connectors_dir = state.engine.store().asset_store_connectors_dir();
    let inspection = match inspect_connectors_from_dirs(&[
        state.connectors_dir.as_path(),
        asset_store_connectors_dir.as_path(),
    ]) {
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
                connector: connector_view(&connector, &HashMap::new(), &HashMap::new()),
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
    match workflow_inventory(state.engine.store(), &state.connectors_dir, &state.workflows_dir)
        .await
    {
        Ok(inventory) => (StatusCode::OK, Json(json!(inventory))),
        Err(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
        }
    }
}

async fn persist_connector_record_from_dir(
    store: &RunStore,
    connectors_dir: &Path,
    connector_dir: &Path,
    source_kind: &str,
    source_ref: Option<&str>,
) -> Result<(), TriggerError> {
    let canonical_connector_dir = fs::canonicalize(connector_dir).map_err(TriggerError::Io)?;
    let inspection = inspect_connectors(connectors_dir)?;
    let connector = inspection
        .connectors
        .into_iter()
        .find(|candidate| candidate.connector_dir == canonical_connector_dir)
        .ok_or_else(|| {
            TriggerError::Connector(ConnectorError::InvalidManifest {
                message: format!(
                    "connector at {} could not be reloaded after install",
                    canonical_connector_dir.display()
                ),
            })
        })?;
    let manifest_json = serde_json::to_string(&connector.manifest)
        .map_err(|error| TriggerError::Connector(ConnectorError::Json(error)))?;
    let connector_dir_string = connector.connector_dir.display().to_string();
    let manifest_path_string = connector.manifest_path.display().to_string();
    let runtime = connector_runtime_name(connector.manifest.runtime);

    store
        .upsert_asset_record(NewAssetRecord {
            asset_kind: "connector",
            type_name: &connector.manifest.type_id,
            name: &connector.manifest.name,
            description: &connector.manifest.name,
            category: Some("Apps"),
            runtime: Some(runtime),
            source_kind,
            source_ref,
            definition_json: &manifest_json,
            installed_version: connector.manifest.version.as_deref(),
            available_version: connector.manifest.version.as_deref(),
            is_locally_modified: false,
        })
        .await?;

    store
        .upsert_connector_record(NewConnectorRecord {
            type_name: &connector.manifest.type_id,
            name: &connector.manifest.name,
            runtime,
            source_kind,
            source_ref,
            connector_dir: &connector_dir_string,
            manifest_path: &manifest_path_string,
            manifest_json: &manifest_json,
        })
        .await?;

    Ok(())
}

pub async fn sync_repo_authored_connector_assets(
    store: &RunStore,
    connectors_dir: &Path,
) -> Result<(), TriggerError> {
    if !connectors_dir.exists() {
        return Ok(());
    }

    let inspection = inspect_connectors(connectors_dir)?;
    let asset_store = AssetStore::new(store.asset_store_root())?;
    let install_root = asset_store.connectors_dir();

    for connector in inspection.connectors {
        match store.get_asset_record("connector", &connector.manifest.type_id).await {
            Ok(existing_asset) => {
                if existing_asset.source_kind != "shipped" || existing_asset.is_locally_modified {
                    continue;
                }
            }
            Err(crate::storage::StorageError::AssetRecordNotFound(_, _)) => {}
            Err(error) => return Err(error.into()),
        }

        let dir_name =
            connector.connector_dir.file_name().and_then(|value| value.to_str()).ok_or_else(
                || {
                    TriggerError::Connector(ConnectorError::InvalidManifest {
                        message: format!(
                            "connector directory {} has no valid name",
                            connector.connector_dir.display()
                        ),
                    })
                },
            )?;
        let stored_bundle =
            asset_store.store_connector_bundle(dir_name, &connector.connector_dir)?;
        persist_connector_record_from_dir(
            store,
            &install_root,
            &stored_bundle.connector_dir,
            "shipped",
            Some(dir_name),
        )
        .await?;
    }

    Ok(())
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
                editor_snapshot: run.editor_snapshot.clone(),
                human_tasks: human_tasks.into_iter().map(human_task_view).collect(),
                run: run_view(run.clone()),
                step_runs: step_runs.into_iter().map(step_run_view).collect(),
                workflow_snapshot: run.workflow_snapshot.clone(),
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
    match read_workflow_document(
        state.engine.store(),
        &state.connectors_dir,
        &state.workflows_dir,
        &workflow_id,
    )
    .await
    {
        Ok(document) => (StatusCode::OK, Json(json!(document))).into_response(),
        Err(error) => workflow_error_response(error),
    }
}

async fn create_workflow(
    State(state): State<AppState>,
    Json(request): Json<CreateWorkflowRequest>,
) -> axum::response::Response {
    match create_workflow_document(
        state.engine.store(),
        &state.connectors_dir,
        &state.workflows_dir,
        request,
    )
    .await
    {
        Ok(document) => (StatusCode::CREATED, Json(json!(document))).into_response(),
        Err(error) => workflow_error_response(error),
    }
}

async fn save_workflow(
    State(state): State<AppState>,
    AxumPath(workflow_id): AxumPath<String>,
    Json(request): Json<SaveWorkflowRequest>,
) -> axum::response::Response {
    match save_workflow_document(
        state.engine.store(),
        &state.connectors_dir,
        &state.workflows_dir,
        &workflow_id,
        &request.yaml,
    )
    .await
    {
        Ok(document) => (StatusCode::OK, Json(json!(document))).into_response(),
        Err(error) => workflow_error_response(error),
    }
}

async fn delete_workflow(
    State(state): State<AppState>,
    AxumPath(workflow_id): AxumPath<String>,
) -> axum::response::Response {
    match delete_workflow_document(state.engine.store(), &workflow_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => workflow_error_response(error),
    }
}

async fn duplicate_workflow(
    State(state): State<AppState>,
    AxumPath(workflow_id): AxumPath<String>,
    Json(request): Json<DuplicateWorkflowRequest>,
) -> axum::response::Response {
    match duplicate_workflow_document(
        state.engine.store(),
        &state.connectors_dir,
        &state.workflows_dir,
        &workflow_id,
        &request.target_id,
    )
    .await
    {
        Ok(document) => (StatusCode::CREATED, Json(json!(document))).into_response(),
        Err(error) => workflow_error_response(error),
    }
}

async fn rename_workflow(
    State(state): State<AppState>,
    AxumPath(workflow_id): AxumPath<String>,
    Json(request): Json<RenameWorkflowRequest>,
) -> axum::response::Response {
    match rename_workflow_document(
        state.engine.store(),
        &state.connectors_dir,
        &state.workflows_dir,
        &workflow_id,
        request,
    )
    .await
    {
        Ok(document) => (StatusCode::OK, Json(json!(document))).into_response(),
        Err(error) => workflow_error_response(error),
    }
}

async fn run_workflow(
    State(state): State<AppState>,
    AxumPath(workflow_id): AxumPath<String>,
    Json(request): Json<RunWorkflowRequest>,
) -> axum::response::Response {
    let record = match load_persisted_workflow_record(state.engine.store(), &workflow_id).await {
        Ok(record) => record,
        Err(error) => return workflow_error_response(error),
    };
    let document_state = match parse_workflow_document_state(&record.yaml) {
        Ok(document_state) => document_state,
        Err(error) => return workflow_error_response(error),
    };
    let plan = match compile_workflow(document_state.workflow.clone()) {
        Ok(plan) => plan,
        Err(error) => {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": error.to_string() })))
                .into_response();
        }
    };

    let initial_payload = json!({
        "payload": request.payload.unwrap_or_else(|| json!({})),
        "requested_at": Utc::now().to_rfc3339(),
        "source": "ui",
        "workflow_id": workflow_id
    });
    match state
        .engine
        .execute_plan_with_editor_snapshot(&plan, initial_payload, record.yaml.clone())
        .await
    {
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
    let record = match load_persisted_workflow_record(state.engine.store(), &workflow_id).await {
        Ok(record) => record,
        Err(error) => return workflow_error_response(error),
    };
    let document_state = match parse_workflow_document_state(&record.yaml) {
        Ok(document_state) => document_state,
        Err(error) => return workflow_error_response(error),
    };
    let plan = match compile_workflow(document_state.workflow.clone()) {
        Ok(plan) => plan,
        Err(error) => {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": error.to_string() })))
                .into_response();
        }
    };

    let initial_payload = json!({
        "payload": request.payload.unwrap_or_else(|| json!({})),
        "requested_at": Utc::now().to_rfc3339(),
        "source": "ui",
        "workflow_id": workflow_id
    });
    match state
        .engine
        .start_plan_with_editor_snapshot(plan, initial_payload, record.yaml.clone())
        .await
    {
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

async fn import_n8n_workflow(Json(request): Json<N8nImportRequest>) -> impl IntoResponse {
    match translate_n8n_workflow(request.workflow_json) {
        Ok(response) => (StatusCode::OK, Json(response)).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("invalid n8n workflow payload: {error}") })),
        )
            .into_response(),
    }
}

fn build_workflow_summary(
    workflow_id: String,
    workflow: &Workflow,
    facts: WorkflowFacts,
) -> WorkflowSummary {
    let state = workflow_state_from_facts(facts);
    WorkflowSummary {
        description: format!(
            "{} trigger, {} step{}",
            workflow.trigger.r#type,
            workflow.steps.len(),
            if workflow.steps.len() == 1 { "" } else { "s" }
        ),
        file_name: format!("{workflow_id}.yaml"),
        has_connector_steps: !state.readiness.connector_requirements.required_step_types.is_empty(),
        id: workflow_id,
        name: workflow.name.clone(),
        workflow_state: state.clone(),
        step_count: workflow.steps.len(),
        trigger_type: workflow.trigger.r#type.clone(),
    }
}

fn workflow_summary(
    workflow_id: String,
    workflow: &Workflow,
    facts: WorkflowFacts,
) -> WorkflowSummary {
    build_workflow_summary(workflow_id, workflow, facts)
}

fn fallback_workflow_summary(workflow_id: String, workflow: &Workflow) -> WorkflowSummary {
    workflow_summary(
        workflow_id,
        workflow,
        workflow_facts(
            workflow,
            WorkflowLifecycleState::Saved,
            WorkflowValidationState::Valid,
            None,
            false,
            false,
            false,
        ),
    )
}

struct WorkflowSummaryContext {
    connector_states: HashMap<String, ProductConnectorState>,
    latest_runs: HashMap<String, WorkflowTelemetryFacts>,
    workflow_name_counts: BTreeMap<String, usize>,
}

async fn workflow_summary_context(
    store: &RunStore,
    connectors_dir: &Path,
    _workflows_dir: &Path,
) -> Result<WorkflowSummaryContext, TriggerError> {
    let connector_inspection = inspect_connectors(connectors_dir)?;
    let mut connector_states = connector_inspection
        .connectors
        .iter()
        .map(|connector| (connector.manifest.type_id.clone(), connector_state(connector)))
        .collect::<HashMap<_, _>>();
    for connector in &connector_inspection.invalid {
        let Some(type_id) = connector.attempted_type_id.as_ref() else {
            continue;
        };
        connector_states
            .entry(type_id.clone())
            .or_insert_with(|| invalid_connector_state(connector));
    }

    let mut workflow_name_counts = BTreeMap::<String, usize>::new();
    for record in store.list_workflows().await? {
        let Ok(workflow) = parse_workflow_yaml(&record.yaml) else {
            continue;
        };
        *workflow_name_counts.entry(workflow.name).or_insert(0) += 1;
    }

    let workflow_names: Vec<String> = workflow_name_counts
        .iter()
        .filter(|(_, count)| **count == 1)
        .map(|(workflow_name, _)| workflow_name.clone())
        .collect();
    let latest_runs =
        latest_workflow_telemetry(store.latest_runs_for_workflows(&workflow_names).await?);

    Ok(WorkflowSummaryContext { connector_states, latest_runs, workflow_name_counts })
}

fn workflow_summary_from_context(
    workflow_id: String,
    workflow: &Workflow,
    context: &WorkflowSummaryContext,
) -> WorkflowSummary {
    let connector_requirements = workflow_connector_requirements(workflow);
    let (connector_requirements_unmet, connector_runtime_blocked, connector_setup_blocked) =
        workflow_connector_block_facts(&connector_requirements, &context.connector_states);
    let latest_run = if context.workflow_name_counts.get(&workflow.name).copied().unwrap_or(0) == 1
    {
        context.latest_runs.get(workflow.name.as_str())
    } else {
        None
    };

    workflow_summary(
        workflow_id,
        workflow,
        workflow_facts(
            workflow,
            WorkflowLifecycleState::Saved,
            WorkflowValidationState::Valid,
            latest_run,
            connector_requirements_unmet,
            connector_runtime_blocked,
            connector_setup_blocked,
        ),
    )
}

async fn workflow_summary_after_write(
    store: &RunStore,
    connectors_dir: &Path,
    workflows_dir: &Path,
    workflow_id: String,
    workflow: &Workflow,
) -> WorkflowSummary {
    match workflow_summary_context(store, connectors_dir, workflows_dir).await {
        Ok(context) => workflow_summary_from_context(workflow_id, workflow, &context),
        Err(error) => {
            warn!(
                error = %error,
                workflow_id,
                "workflow summary enrichment failed after write; returning fallback summary"
            );
            fallback_workflow_summary(workflow_id, workflow)
        }
    }
}

fn workflow_facts(
    workflow: &Workflow,
    lifecycle: WorkflowLifecycleState,
    validation_state: WorkflowValidationState,
    latest_run: Option<&WorkflowTelemetryFacts>,
    connector_requirements_unmet: bool,
    connector_runtime_blocked: bool,
    connector_setup_blocked: bool,
) -> WorkflowFacts {
    WorkflowFacts {
        connector_requirements: workflow_connector_requirements(workflow),
        connector_requirements_unmet,
        connector_runtime_blocked,
        connector_setup_blocked,
        latest_run: latest_run.cloned(),
        lifecycle,
        validation_state,
    }
}

async fn create_workflow_document(
    store: &RunStore,
    connectors_dir: &Path,
    workflows_dir: &Path,
    request: CreateWorkflowRequest,
) -> Result<WorkflowDocumentResponse, TriggerError> {
    let document_state = parse_workflow_document_state(&request.yaml)?;
    let workflow_id = request
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| slugify_workflow_name(&document_state.workflow.name));
    validate_workflow_id(&workflow_id)?;
    let response_yaml = serialize_workflow_yaml(
        &document_state.workflow,
        &document_state.ui_positions,
        &document_state.ui_detached_steps,
    )?;
    let response = match store
        .create_workflow(&workflow_id, &document_state.workflow.name, &response_yaml)
        .await
    {
        Ok(record) => WorkflowWriteResult { id: record.id, yaml: record.yaml },
        Err(crate::storage::StorageError::WorkflowAlreadyExists(_)) => {
            return Err(TriggerError::WorkflowAlreadyExists { workflow_id });
        }
        Err(error) => return Err(error.into()),
    };
    Ok(WorkflowDocumentResponse {
        id: response.id,
        summary: workflow_summary_after_write(
            store,
            connectors_dir,
            workflows_dir,
            workflow_id,
            &document_state.workflow,
        )
        .await,
        yaml: response.yaml,
    })
}

async fn delete_workflow_document(store: &RunStore, workflow_id: &str) -> Result<(), TriggerError> {
    validate_workflow_id(workflow_id)?;
    match store.delete_workflow(workflow_id).await {
        Ok(()) => Ok(()),
        Err(crate::storage::StorageError::WorkflowNotFound(_)) => {
            Err(TriggerError::WorkflowNotFound { workflow_id: workflow_id.to_string() })
        }
        Err(error) => Err(error.into()),
    }
}

async fn duplicate_workflow_document(
    store: &RunStore,
    connectors_dir: &Path,
    workflows_dir: &Path,
    workflow_id: &str,
    target_id: &str,
) -> Result<WorkflowDocumentResponse, TriggerError> {
    let source_document =
        read_workflow_document(store, connectors_dir, workflows_dir, workflow_id).await?;
    let mut document_state = parse_workflow_document_state(&source_document.yaml)?;
    document_state.workflow.name = format!("{} copy", document_state.workflow.name);
    validate_workflow_id(target_id)?;
    let response_yaml = serialize_workflow_yaml(
        &document_state.workflow,
        &document_state.ui_positions,
        &document_state.ui_detached_steps,
    )?;
    let response = match store
        .create_workflow(target_id, &document_state.workflow.name, &response_yaml)
        .await
    {
        Ok(record) => WorkflowWriteResult { id: record.id, yaml: record.yaml },
        Err(crate::storage::StorageError::WorkflowAlreadyExists(_)) => {
            return Err(TriggerError::WorkflowAlreadyExists { workflow_id: target_id.to_string() });
        }
        Err(error) => return Err(error.into()),
    };
    Ok(WorkflowDocumentResponse {
        id: response.id,
        summary: workflow_summary_after_write(
            store,
            connectors_dir,
            workflows_dir,
            target_id.to_string(),
            &document_state.workflow,
        )
        .await,
        yaml: response.yaml,
    })
}

async fn rename_workflow_document(
    store: &RunStore,
    connectors_dir: &Path,
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
            let source_document =
                read_workflow_document(store, connectors_dir, workflows_dir, workflow_id).await?;
            parse_workflow_document_state(&source_document.yaml)?
        }
    };
    document_state.workflow.name = next_name.to_string();
    validate_workflow_id(workflow_id)?;
    validate_workflow_id(&request.target_id)?;
    let response_yaml = serialize_workflow_yaml(
        &document_state.workflow,
        &document_state.ui_positions,
        &document_state.ui_detached_steps,
    )?;
    let response = match store
        .rename_workflow(
            workflow_id,
            &request.target_id,
            &document_state.workflow.name,
            &response_yaml,
        )
        .await
    {
        Ok(record) => WorkflowWriteResult { id: record.id, yaml: record.yaml },
        Err(crate::storage::StorageError::WorkflowNotFound(_)) => {
            return Err(TriggerError::WorkflowNotFound { workflow_id: workflow_id.to_string() });
        }
        Err(crate::storage::StorageError::WorkflowAlreadyExists(_)) => {
            return Err(TriggerError::WorkflowAlreadyExists { workflow_id: request.target_id });
        }
        Err(error) => return Err(error.into()),
    };

    Ok(WorkflowDocumentResponse {
        id: response.id.clone(),
        summary: workflow_summary_after_write(
            store,
            connectors_dir,
            workflows_dir,
            response.id,
            &document_state.workflow,
        )
        .await,
        yaml: response.yaml,
    })
}

async fn connector_inventory(
    store: &RunStore,
    connectors_dir: &Path,
) -> Result<ConnectorInventoryResponse, TriggerError> {
    let asset_store_connectors_dir = store.asset_store_connectors_dir();
    let inspection =
        inspect_connectors_from_dirs(&[connectors_dir, asset_store_connectors_dir.as_path()])?;
    let workflow_dependencies = connector_usage_by_workflow(store).await?;
    let connector_records = connector_record_map(store).await?;
    Ok(ConnectorInventoryResponse {
        connectors: inspection
            .connectors
            .iter()
            .map(|connector| connector_view(connector, &workflow_dependencies, &connector_records))
            .collect(),
        invalid_connectors: inspection
            .invalid
            .iter()
            .map(|connector| {
                invalid_connector_view(connector, &workflow_dependencies, &connector_records)
            })
            .collect(),
        wasm_enabled: wasm_connectors_enabled(),
    })
}

async fn connector_record_map(
    store: &RunStore,
) -> Result<HashMap<String, ConnectorRecordView>, TriggerError> {
    let connector_assets = store
        .list_asset_records()
        .await?
        .into_iter()
        .filter(|record| record.asset_kind == "connector")
        .map(|record| (record.type_name.clone(), record))
        .collect::<HashMap<_, _>>();

    Ok(store
        .list_connector_records()
        .await?
        .into_iter()
        .map(|record| {
            let asset = connector_assets.get(&record.type_name);
            (
                record.type_name.clone(),
                ConnectorRecordView {
                    available_version: asset.and_then(|item| item.available_version.clone()),
                    description: asset.map(|item| item.description.clone()),
                    installed_version: asset.and_then(|item| item.installed_version.clone()),
                    is_locally_modified: asset.is_some_and(|item| item.is_locally_modified),
                    name: asset.map(|item| item.name.clone()),
                    source_kind: asset
                        .map(|item| item.source_kind.clone())
                        .unwrap_or(record.source_kind),
                    source_ref: asset
                        .and_then(|item| item.source_ref.clone())
                        .or(record.source_ref),
                },
            )
        })
        .collect())
}

async fn node_record_map(
    store: &RunStore,
) -> Result<HashMap<String, NodeRecordView>, TriggerError> {
    let base_type_names = node_asset_base_type_map(store).await?;
    Ok(store
        .list_node_records()
        .await?
        .into_iter()
        .map(|record| {
            let type_name = record.type_name.clone();
            (
                type_name.clone(),
                NodeRecordView {
                    base_type_name: base_type_names.get(&type_name).cloned(),
                    source_kind: record.source_kind,
                    source_ref: record.source_ref,
                },
            )
        })
        .collect())
}

async fn node_asset_base_type_map(
    store: &RunStore,
) -> Result<HashMap<String, String>, TriggerError> {
    Ok(store
        .list_asset_records()
        .await?
        .into_iter()
        .filter(|record| record.asset_kind == "node")
        .filter_map(|record| {
            parse_node_asset_base_type(&record)
                .map(|base_type_name| (record.type_name, base_type_name))
        })
        .collect())
}

fn parse_node_asset_base_type(record: &AssetRecord) -> Option<String> {
    let definition = serde_json::from_str::<AliasNodeDefinition>(&record.definition_json).ok()?;
    if definition.kind != "alias" || definition.base_type.trim().is_empty() {
        return None;
    }

    Some(definition.base_type)
}

async fn starter_connector_pack_views(
    store: &RunStore,
    connectors_dir: &Path,
) -> Result<Vec<StarterConnectorPackView>, TriggerError> {
    let pack_states = starter_pack_install_state_map(store, connectors_dir).await?;
    let packs = crate::starter_connector_packs::starter_connector_packs()
        .map_err(TriggerError::StarterPack)?;
    Ok(packs
        .iter()
        .map(|pack| starter_connector_pack_view(pack, pack_states.get(pack.install_dir_name)))
        .collect())
}

async fn starter_pack_install_state_map(
    store: &RunStore,
    connectors_dir: &Path,
) -> Result<HashMap<String, ProductConnectorState>, TriggerError> {
    let inventory = connector_inventory(store, connectors_dir).await?;
    let mut states = HashMap::new();

    for connector in inventory.connectors {
        if let Some(dir_name) = Path::new(&connector.connector_dir).file_name() {
            states.insert(dir_name.to_string_lossy().to_string(), connector.connector_state);
        }
    }

    for connector in inventory.invalid_connectors {
        if let Some(dir_name) = Path::new(&connector.connector_dir).file_name() {
            states
                .entry(dir_name.to_string_lossy().to_string())
                .or_insert(connector.connector_state);
        }
    }

    Ok(states)
}

fn starter_connector_pack_view(
    pack: &crate::starter_connector_packs::StarterConnectorPack,
    connector_state: Option<&ProductConnectorState>,
) -> StarterConnectorPackView {
    let install_state = starter_connector_pack_install_state(connector_state);
    StarterConnectorPackView {
        description: pack.description.to_string(),
        id: pack.id.to_string(),
        install_state: install_state.to_string(),
        installed: install_state == "satisfied",
        name: pack.name.to_string(),
        provided_step_types: pack
            .provided_step_types
            .iter()
            .map(|value| value.to_string())
            .collect(),
    }
}

fn starter_connector_pack_install_state(
    connector_state: Option<&ProductConnectorState>,
) -> &'static str {
    match connector_state {
        None => "available",
        Some(state) if !state.install_validity.valid => "invalid",
        Some(state) => match state.trust {
            ProductConnectorTrustState::Trusted => "satisfied",
            ProductConnectorTrustState::SetupRequired => "setup_required",
            ProductConnectorTrustState::RuntimeRestricted => "runtime_restricted",
        },
    }
}

fn node_record_response(
    record: crate::storage::NodeRecord,
    base_type_name: Option<String>,
) -> NodeRecordResponse {
    NodeRecordResponse {
        base_type_name,
        category: record.category,
        description: record.description,
        id: record.id,
        label: record.label,
        source_kind: record.source_kind,
        source_ref: record.source_ref,
        type_name: record.type_name,
        updated_at: record.updated_at,
    }
}

fn built_in_step_specs() -> [(&'static str, &'static str, &'static str, &'static str); 17] {
    [
        ("constant", "Set value", "Produce a fixed value for downstream steps.", "Data"),
        ("noop", "Pass through", "Pass inputs through without changing them.", "Flow"),
        ("condition", "Branch", "Route execution based on a condition.", "Flow"),
        ("switch", "Choose path", "Select one branch from named options.", "Flow"),
        (
            "loop",
            "Repeat for each item",
            "Run the inner step for each item in a collection.",
            "Flow",
        ),
        (
            "parallel",
            "Run in parallel",
            "Run nested steps at the same time and join their outputs.",
            "Flow",
        ),
        ("http_request", "Send request", "Send an HTTP request to an app or API.", "Apps"),
        ("database_query", "Query data", "Run a query against the configured database.", "Data"),
        ("file_read", "Read file", "Read a file from the local data workspace.", "Data"),
        ("file_write", "Write file", "Write a file to the local data workspace.", "Data"),
        (
            "llm_completion",
            "Generate text",
            "Generate a completion with the configured LLM provider.",
            "AI",
        ),
        ("classification", "Classify", "Assign labels to a record using the AI model.", "AI"),
        ("extraction", "Extract fields", "Pull structured fields from unstructured text.", "AI"),
        (
            "embedding",
            "Store knowledge",
            "Store text as an embedding in the in-memory vector store.",
            "AI",
        ),
        (
            "retrieval",
            "Find related knowledge",
            "Search stored embeddings for similar content.",
            "AI",
        ),
        (
            "approval",
            "Request approval",
            "Pause until a reviewer approves or rejects the task.",
            "Human",
        ),
        ("manual_input", "Ask for input", "Pause until a human provides a value.", "Human"),
    ]
}

async fn ensure_shipped_asset_records(store: &RunStore) -> Result<(), TriggerError> {
    for (type_name, name, description, category) in built_in_step_specs() {
        if store.get_asset_record("node", type_name).await.is_ok() {
            continue;
        }
        let definition_json = serde_json::to_string(&json!({
            "asset_kind": "node",
            "type_name": type_name,
            "built_in": true,
        }))
        .map_err(|error| TriggerError::SerializeWorkflowYaml { message: error.to_string() })?;
        store
            .upsert_asset_record(NewAssetRecord {
                asset_kind: "node",
                type_name,
                name,
                description,
                category: Some(category),
                runtime: None,
                source_kind: "shipped",
                source_ref: Some("built_in"),
                definition_json: &definition_json,
                installed_version: Some("1.0.0"),
                available_version: Some("1.0.0"),
                is_locally_modified: false,
            })
            .await?;
    }

    for pack in crate::starter_connector_packs::starter_connector_packs()? {
        let manifest_path = pack.source_dir.join("manifest.json");
        let raw_manifest = fs::read_to_string(&manifest_path)?;
        let manifest =
            serde_json::from_str::<ConnectorManifest>(&raw_manifest).map_err(|error| {
                TriggerError::Connector(ConnectorError::InvalidManifest {
                    message: format!(
                        "failed to parse shipped starter pack manifest {}: {error}",
                        manifest_path.display()
                    ),
                })
            })?;
        let type_name =
            pack.provided_step_types.first().copied().unwrap_or(manifest.type_id.as_str());
        if store.get_asset_record("connector", type_name).await.is_ok() {
            continue;
        }
        store
            .upsert_asset_record(NewAssetRecord {
                asset_kind: "connector",
                type_name,
                name: pack.name,
                description: pack.description,
                category: Some("Apps"),
                runtime: Some(connector_runtime_name(manifest.runtime)),
                source_kind: "shipped",
                source_ref: Some(pack.id),
                definition_json: &raw_manifest,
                installed_version: manifest.version.as_deref(),
                available_version: manifest.version.as_deref(),
                is_locally_modified: false,
            })
            .await?;
    }

    Ok(())
}

async fn asset_record_map(
    store: &RunStore,
    asset_kind: &str,
) -> Result<HashMap<String, AssetRecord>, TriggerError> {
    Ok(store
        .list_asset_records()
        .await?
        .into_iter()
        .filter(|record| record.asset_kind == asset_kind)
        .map(|record| (record.type_name.clone(), record))
        .collect())
}

async fn connector_usage_by_workflow(
    store: &RunStore,
) -> Result<HashMap<String, Vec<String>>, TriggerError> {
    let mut usage = HashMap::<String, HashSet<String>>::new();

    for record in store.list_workflows().await? {
        let Ok(workflow) = parse_workflow_yaml(&record.yaml) else {
            continue;
        };
        let requirements = workflow_connector_requirements(&workflow);
        for type_name in requirements.required_step_types {
            usage.entry(type_name).or_default().insert(workflow.name.clone());
        }
    }

    Ok(usage
        .into_iter()
        .map(|(type_name, workflows)| {
            let mut used_by_workflows = workflows.into_iter().collect::<Vec<_>>();
            used_by_workflows.sort();
            (type_name, used_by_workflows)
        })
        .collect())
}

async fn node_catalog(
    store: &RunStore,
    connectors_dir: &Path,
) -> Result<(Vec<StepTypeEntry>, Vec<TriggerTypeEntry>), TriggerError> {
    ensure_shipped_asset_records(store).await?;
    let shipped_node_assets = asset_record_map(store, "node").await?;
    let shipped_connector_assets = asset_record_map(store, "connector").await?;
    let node_records = node_record_map(store).await?;
    let mut step_types = vec![
        StepTypeEntry {
            app_record: node_records.get("constant").cloned(),
            category: "Data".to_string(),
            description: "Produce a fixed value for downstream steps.".to_string(),
            label: "Set value".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "constant".to_string(),
        },
        StepTypeEntry {
            app_record: node_records.get("noop").cloned(),
            category: "Flow".to_string(),
            description: "Pass inputs through without changing them.".to_string(),
            label: "Pass through".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "noop".to_string(),
        },
        StepTypeEntry {
            app_record: node_records.get("condition").cloned(),
            category: "Flow".to_string(),
            description: "Route execution based on a condition.".to_string(),
            label: "Branch".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "condition".to_string(),
        },
        StepTypeEntry {
            app_record: node_records.get("switch").cloned(),
            category: "Flow".to_string(),
            description: "Select one branch from named options.".to_string(),
            label: "Choose path".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "switch".to_string(),
        },
        StepTypeEntry {
            app_record: node_records.get("loop").cloned(),
            category: "Flow".to_string(),
            description: "Run the inner step for each item in a collection.".to_string(),
            label: "Repeat for each item".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "loop".to_string(),
        },
        StepTypeEntry {
            app_record: node_records.get("parallel").cloned(),
            category: "Flow".to_string(),
            description: "Run nested steps at the same time and join their outputs.".to_string(),
            label: "Run in parallel".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "parallel".to_string(),
        },
        StepTypeEntry {
            app_record: node_records.get("http_request").cloned(),
            category: "Apps".to_string(),
            description: "Send an HTTP request to an app or API.".to_string(),
            label: "Send request".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "http_request".to_string(),
        },
        StepTypeEntry {
            app_record: node_records.get("database_query").cloned(),
            category: "Data".to_string(),
            description: "Run a query against the configured database.".to_string(),
            label: "Query data".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "database_query".to_string(),
        },
        StepTypeEntry {
            app_record: node_records.get("file_read").cloned(),
            category: "Data".to_string(),
            description: "Read a file from the local data workspace.".to_string(),
            label: "Read file".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "file_read".to_string(),
        },
        StepTypeEntry {
            app_record: node_records.get("file_write").cloned(),
            category: "Data".to_string(),
            description: "Write a file to the local data workspace.".to_string(),
            label: "Write file".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "file_write".to_string(),
        },
        StepTypeEntry {
            app_record: node_records.get("llm_completion").cloned(),
            category: "AI".to_string(),
            description: "Generate a completion with the configured LLM provider.".to_string(),
            label: "Generate text".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "llm_completion".to_string(),
        },
        StepTypeEntry {
            app_record: node_records.get("classification").cloned(),
            category: "AI".to_string(),
            description: "Assign labels to a record using the AI model.".to_string(),
            label: "Classify".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "classification".to_string(),
        },
        StepTypeEntry {
            app_record: node_records.get("extraction").cloned(),
            category: "AI".to_string(),
            description: "Pull structured fields from unstructured text.".to_string(),
            label: "Extract fields".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "extraction".to_string(),
        },
        StepTypeEntry {
            app_record: node_records.get("embedding").cloned(),
            category: "AI".to_string(),
            description: "Store text as an embedding in the in-memory vector store.".to_string(),
            label: "Store knowledge".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "embedding".to_string(),
        },
        StepTypeEntry {
            app_record: node_records.get("retrieval").cloned(),
            category: "AI".to_string(),
            description: "Search stored embeddings for similar content.".to_string(),
            label: "Find related knowledge".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "retrieval".to_string(),
        },
        StepTypeEntry {
            app_record: node_records.get("approval").cloned(),
            category: "Human".to_string(),
            description: "Pause until a reviewer approves or rejects the task.".to_string(),
            label: "Request approval".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "approval".to_string(),
        },
        StepTypeEntry {
            app_record: node_records.get("manual_input").cloned(),
            category: "Human".to_string(),
            description: "Pause until a human provides a value.".to_string(),
            label: "Ask for input".to_string(),
            runtime: None,
            source: "built_in".to_string(),
            type_name: "manual_input".to_string(),
        },
    ];
    let asset_store_connectors_dir = store.asset_store_connectors_dir();
    let mut connectors = discover_connector_manifests_from_dirs(&[
        connectors_dir,
        asset_store_connectors_dir.as_path(),
    ])?
    .into_iter()
    .map(|manifest| StepTypeEntry {
        app_record: node_records.get(&manifest.type_id).cloned(),
        category: "Apps".to_string(),
        description: format!(
            "{} app connector loaded from manifest.",
            connector_runtime_name(manifest.runtime).to_uppercase()
        ),
        label: manifest.name,
        runtime: Some(connector_runtime_name(manifest.runtime).to_string()),
        source: "connector".to_string(),
        type_name: manifest.type_id,
    })
    .collect::<Vec<_>>();
    step_types.append(&mut connectors);
    for entry in &mut step_types {
        let shipped_asset = match entry.source.as_str() {
            "built_in" => shipped_node_assets.get(&entry.type_name),
            "connector" => shipped_connector_assets.get(&entry.type_name),
            _ => None,
        };

        if let Some(asset) = shipped_asset {
            entry.label = asset.name.clone();
            entry.description = asset.description.clone();
            if let Some(category) = &asset.category {
                entry.category = category.clone();
            }
            if entry.source == "connector" {
                entry.runtime = asset.runtime.clone().or_else(|| entry.runtime.clone());
            }
        }
    }
    let existing_type_names =
        step_types.iter().map(|entry| entry.type_name.clone()).collect::<HashSet<_>>();
    let mut standalone_records = store
        .list_node_records()
        .await?
        .into_iter()
        .filter(|record| !existing_type_names.contains(&record.type_name))
        .map(|record| StepTypeEntry {
            app_record: node_records.get(&record.type_name).cloned(),
            category: record.category,
            description: record.description,
            label: record.label,
            runtime: None,
            source: record.source_kind,
            type_name: record.type_name,
        })
        .collect::<Vec<_>>();
    step_types.append(&mut standalone_records);
    step_types.sort_by(|left, right| left.label.cmp(&right.label));

    Ok((
        step_types,
        vec![
            TriggerTypeEntry {
                description: "Start workflows on demand from the editor or CLI.".to_string(),
                label: "Run manually".to_string(),
                type_name: "manual".to_string(),
            },
            TriggerTypeEntry {
                description: "Start workflows from a cron schedule.".to_string(),
                label: "Run on a schedule".to_string(),
                type_name: "cron".to_string(),
            },
            TriggerTypeEntry {
                description: "Start workflows from authenticated HTTP requests.".to_string(),
                label: "Receive webhook".to_string(),
                type_name: "webhook".to_string(),
            },
        ],
    ))
}

fn connector_view(
    connector: &crate::connectors::DiscoveredConnector,
    workflow_dependencies: &HashMap<String, Vec<String>>,
    connector_records: &HashMap<String, ConnectorRecordView>,
) -> ConnectorView {
    let state = connector_state(connector);
    let readme_path = connector.connector_dir.join("README.md");
    let sample_input_path = connector.connector_dir.join("sample-input.json");
    let runtime = connector_runtime_name(connector.manifest.runtime).to_string();
    let runtime_ready = state.runtime.ready;
    let provided_step_types = vec![connector.manifest.type_id.clone()];
    let mut notes = Vec::new();
    if connector.manifest.runtime == ConnectorRuntime::Wasm && !runtime_ready {
        notes.push("Enable ACSA_ENABLE_WASM_CONNECTORS=1 to run this connector.".to_string());
    }
    if !sample_input_path.exists() {
        notes.push("Add a sample input to enable one-click sample tests.".to_string());
    }
    let app_record = connector_records.get(&connector.manifest.type_id).cloned();
    let name = app_record
        .as_ref()
        .and_then(|record| record.name.clone())
        .unwrap_or_else(|| connector.manifest.name.clone());
    let description = app_record
        .as_ref()
        .and_then(|record| record.description.clone())
        .unwrap_or_else(|| connector.manifest.name.clone());

    ConnectorView {
        allowed_env: connector.manifest.allowed_env.clone(),
        allowed_hosts: connector.manifest.allowed_hosts.clone(),
        app_record,
        connector_dir: state.install_validity.connector_dir.clone(),
        connector_state: state.clone(),
        description,
        entry: connector.manifest.entry.clone(),
        inputs: connector.manifest.inputs.clone(),
        manifest_path: state
            .install_validity
            .manifest_path
            .clone()
            .unwrap_or_else(|| connector.manifest_path.display().to_string()),
        name,
        notes,
        outputs: connector.manifest.outputs.clone(),
        readme_path: readme_path.exists().then(|| readme_path.display().to_string()),
        required_by_templates: Vec::new(),
        runtime,
        runtime_ready,
        runtime_status: if runtime_ready {
            "ready".to_string()
        } else {
            "runtime_disabled".to_string()
        },
        sample_input_path: sample_input_path
            .exists()
            .then(|| sample_input_path.display().to_string()),
        provided_step_types: provided_step_types.clone(),
        type_name: connector.manifest.type_id.clone(),
        used_by_workflows: workflow_dependencies
            .get(&connector.manifest.type_id)
            .cloned()
            .unwrap_or_default(),
        version: connector.manifest.version.clone(),
    }
}

fn invalid_connector_view(
    connector: &crate::connectors::InvalidConnector,
    workflow_dependencies: &HashMap<String, Vec<String>>,
    connector_records: &HashMap<String, ConnectorRecordView>,
) -> InvalidConnectorView {
    let state = invalid_connector_state(connector);
    let provided_step_types = connector.attempted_type_id.clone().into_iter().collect::<Vec<_>>();
    let mut used_by_workflows = provided_step_types
        .iter()
        .flat_map(|type_name| workflow_dependencies.get(type_name).cloned().into_iter())
        .flatten()
        .collect::<Vec<_>>();
    used_by_workflows.sort();
    used_by_workflows.dedup();
    InvalidConnectorView {
        app_record: connector
            .attempted_type_id
            .as_ref()
            .and_then(|type_name| connector_records.get(type_name))
            .cloned(),
        connector_dir: state.install_validity.connector_dir.clone(),
        connector_state: state,
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
        provided_step_types: provided_step_types.clone(),
        required_by_templates: Vec::new(),
        used_by_workflows,
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

async fn load_persisted_workflow_record(
    store: &RunStore,
    workflow_id: &str,
) -> Result<WorkflowRecord, TriggerError> {
    validate_workflow_id(workflow_id)?;
    match store.get_workflow(workflow_id).await {
        Ok(record) => Ok(record),
        Err(crate::storage::StorageError::WorkflowNotFound(_)) => {
            Err(TriggerError::WorkflowNotFound { workflow_id: workflow_id.to_string() })
        }
        Err(error) => Err(error.into()),
    }
}

async fn seed_workflows_from_directory_if_missing(
    store: &RunStore,
    workflows_dir: &Path,
) -> Result<(), TriggerError> {
    let entries = match fs::read_dir(workflows_dir) {
        Ok(entries) => entries.collect::<Result<Vec<_>, _>>()?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };

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
        if validate_workflow_id(workflow_id).is_err() {
            continue;
        }

        let Ok(yaml) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(document_state) = parse_workflow_document_state(&yaml) else {
            continue;
        };
        let persisted_yaml = serialize_workflow_yaml(
            &document_state.workflow,
            &document_state.ui_positions,
            &document_state.ui_detached_steps,
        )?;
        store
            .create_workflow_if_missing(workflow_id, &document_state.workflow.name, &persisted_yaml)
            .await?;
    }

    Ok(())
}

async fn read_workflow_document(
    store: &RunStore,
    connectors_dir: &Path,
    workflows_dir: &Path,
    workflow_id: &str,
) -> Result<WorkflowDocumentResponse, TriggerError> {
    let record = load_persisted_workflow_record(store, workflow_id).await?;
    let document_state = parse_workflow_document_state(&record.yaml)?;
    let context = workflow_summary_context(store, connectors_dir, workflows_dir).await?;

    Ok(WorkflowDocumentResponse {
        id: workflow_id.to_string(),
        summary: workflow_summary_from_context(
            workflow_id.to_string(),
            &document_state.workflow,
            &context,
        ),
        yaml: serialize_workflow_yaml(
            &document_state.workflow,
            &document_state.ui_positions,
            &document_state.ui_detached_steps,
        )?,
    })
}

async fn save_workflow_document(
    store: &RunStore,
    connectors_dir: &Path,
    workflows_dir: &Path,
    workflow_id: &str,
    yaml: &str,
) -> Result<WorkflowDocumentResponse, TriggerError> {
    validate_workflow_id(workflow_id)?;
    let document_state = parse_workflow_document_state(yaml)?;
    let response_yaml = serialize_workflow_yaml(
        &document_state.workflow,
        &document_state.ui_positions,
        &document_state.ui_detached_steps,
    )?;
    let response = match store
        .update_workflow(workflow_id, &document_state.workflow.name, &response_yaml)
        .await
    {
        Ok(record) => WorkflowWriteResult { id: record.id, yaml: record.yaml },
        Err(crate::storage::StorageError::WorkflowNotFound(_)) => {
            return Err(TriggerError::WorkflowNotFound { workflow_id: workflow_id.to_string() });
        }
        Err(error) => return Err(error.into()),
    };
    Ok(WorkflowDocumentResponse {
        id: response.id,
        summary: workflow_summary_after_write(
            store,
            connectors_dir,
            workflows_dir,
            workflow_id.to_string(),
            &document_state.workflow,
        )
        .await,
        yaml: response.yaml,
    })
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

fn validate_workflow_id(workflow_id: &str) -> Result<(), TriggerError> {
    if workflow_id.trim().is_empty()
        || workflow_id.chars().any(|character| {
            !(character.is_ascii_alphanumeric() || character == '-' || character == '_')
        })
    {
        return Err(TriggerError::InvalidWorkflowId { workflow_id: workflow_id.to_string() });
    }
    Ok(())
}

async fn workflow_inventory(
    store: &RunStore,
    connectors_dir: &Path,
    workflows_dir: &Path,
) -> Result<WorkflowInventoryResponse, TriggerError> {
    let mut invalid_files = Vec::new();
    let mut parsed_workflows = Vec::new();
    for record in store.list_workflows().await? {
        match parse_workflow_yaml(&record.yaml) {
            Ok(workflow) => parsed_workflows.push((record.id, workflow)),
            Err(error) => invalid_files.push(InvalidWorkflowFile {
                error: error.to_string(),
                file_name: format!("{}.yaml", record.id),
                id: record.id,
            }),
        };
    }

    let context = workflow_summary_context(store, connectors_dir, workflows_dir).await?;

    let mut workflows = Vec::new();
    for (workflow_id, workflow) in parsed_workflows {
        workflows.push(workflow_summary_from_context(workflow_id, &workflow, &context));
    }

    Ok(WorkflowInventoryResponse { invalid_files, workflows })
}

fn workflow_connector_block_facts(
    connector_requirements: &WorkflowConnectorRequirementsState,
    connector_states: &HashMap<String, ProductConnectorState>,
) -> (bool, bool, bool) {
    let mut requirements_unmet = false;
    let mut runtime_blocked = false;
    let mut setup_blocked = false;

    for required_step_type in &connector_requirements.required_step_types {
        let Some(connector_state) = connector_states.get(required_step_type) else {
            requirements_unmet = true;
            continue;
        };

        if !connector_state.install_validity.valid {
            setup_blocked = true;
            continue;
        }

        if !connector_state.runtime.ready {
            match connector_state.trust {
                ProductConnectorTrustState::RuntimeRestricted => runtime_blocked = true,
                ProductConnectorTrustState::SetupRequired => setup_blocked = true,
                ProductConnectorTrustState::Trusted => {}
            }
            continue;
        }

        if !connector_state.setup.required_setup.is_empty() {
            setup_blocked = true;
        }
    }

    (requirements_unmet, runtime_blocked, setup_blocked)
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
    let run_provenance = run_provenance(&run);
    RunView {
        duration_seconds: run
            .finished_at
            .map(|finished_at| finished_at.saturating_sub(run.started_at)),
        error_message: run.error_message.map(|message| redact_text(&message)),
        finished_at: run.finished_at,
        id: run.id,
        run_provenance,
        started_at: run.started_at,
        status: run.status,
        workflow_revision: run.workflow_revision,
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
            let secret = resolve_secret_value(secret_env).ok_or_else(|| {
                TriggerError::MissingWebhookSecretEnv {
                    env_name: secret_env.to_string(),
                    workflow_name: plan.workflow.name.clone(),
                }
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
            let secret = resolve_secret_value(secret_env).ok_or_else(|| {
                TriggerError::MissingWebhookSecretEnv {
                    env_name: secret_env.to_string(),
                    workflow_name: plan.workflow.name.clone(),
                }
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

async fn list_credentials(State(state): State<AppState>) -> Response {
    match state.engine.store().list_credentials().await {
        Ok(records) => {
            let credentials = records.into_iter().map(credential_view).collect::<Vec<_>>();
            (StatusCode::OK, Json(json!(CredentialsResponse { credentials }))).into_response()
        }
        Err(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
                .into_response()
        }
    }
}

async fn upsert_credential(
    State(state): State<AppState>,
    Json(request): Json<UpsertCredentialRequest>,
) -> Response {
    let trimmed_name = request.name.trim();
    let trimmed_value = request.value.trim();

    if let Err(error) = validate_credential_name(&request.name) {
        return credential_validation_error_response(error);
    }
    if trimmed_value.is_empty() {
        return credential_validation_error_response(TriggerError::InvalidCredentialValue {
            name: trimmed_name.to_string(),
            message: "credential value must not be empty".to_string(),
        });
    }

    match state.engine.store().upsert_credential(trimmed_name, trimmed_value).await {
        Ok(record) => (StatusCode::OK, Json(json!(credential_view(record)))).into_response(),
        Err(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
                .into_response()
        }
    }
}

async fn delete_credential(
    State(state): State<AppState>,
    AxumPath(credential_name): AxumPath<String>,
) -> Response {
    if let Err(error) = validate_credential_name(&credential_name) {
        return credential_validation_error_response(error);
    }

    match state.engine.store().delete_credential(credential_name.trim()).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error.to_string() })))
                .into_response()
        }
    }
}

fn credential_view(record: CredentialRecord) -> CredentialView {
    CredentialView {
        is_overridden_by_env: env::var_os(&record.name).is_some(),
        name: record.name,
        updated_at: record.updated_at,
    }
}

fn validate_credential_name(name: &str) -> Result<(), TriggerError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(TriggerError::InvalidCredentialName {
            name: name.to_string(),
            message: "credential name must not be empty".to_string(),
        });
    }

    if !trimmed.chars().all(|character| {
        character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
    }) {
        return Err(TriggerError::InvalidCredentialName {
            name: trimmed.to_string(),
            message: "credential names must use A-Z, 0-9, and underscores only".to_string(),
        });
    }

    Ok(())
}

fn credential_validation_error_response(error: TriggerError) -> Response {
    match error {
        TriggerError::InvalidCredentialName { name, message }
        | TriggerError::InvalidCredentialValue { name, message } => (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": message,
                "name": name,
            })),
        )
            .into_response(),
        other => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": other.to_string() })))
            .into_response(),
    }
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
    #[error("asset store error: {0}")]
    AssetStore(#[from] crate::asset_store::AssetStoreError),
    #[error("connector error: {0}")]
    Connector(#[from] ConnectorError),
    #[error("starter pack error: {0}")]
    StarterPack(#[from] crate::starter_connector_packs::StarterPackError),
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
    #[error("invalid credential name {name}: {message}")]
    InvalidCredentialName { name: String, message: String },
    #[error("invalid credential value for {name}: {message}")]
    InvalidCredentialValue { name: String, message: String },
    #[error("binding the engine to {bind_addr} requires ACSA_ALLOW_REMOTE_ENGINE=1")]
    RemoteBindingRequiresExplicitOptIn { bind_addr: SocketAddr },
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, HashMap};

    use axum::{
        body::to_bytes,
        extract::{Path as AxumPath, State as AxumState},
        http::{header::AUTHORIZATION, HeaderMap, HeaderValue, StatusCode},
        response::IntoResponse,
        Json,
    };
    use chrono::Utc;
    use serde_json::json;
    use serde_yaml::Value as YamlValue;

    use super::{
        authenticate_webhook, build_workflow_summary, compute_signature, connector_inventory,
        connector_view, create_connector, create_workflow_document, cron_schedule,
        ensure_shipped_asset_records, import_n8n_workflow, install_starter_connector_pack_endpoint,
        invalid_connector_view, list_starter_connector_packs, node_catalog,
        parse_workflow_document_state, read_workflow_document, rename_workflow_document,
        request_has_engine_token, run_view, save_workflow_document,
        seed_workflows_from_directory_if_missing, serialize_workflow_yaml, slugify_workflow_name,
        sync_repo_authored_connector_assets, update_connector_record, validate_secret_value,
        validate_workflow_id, workflow_inventory, AppState, CreateConnectorRequest,
        CreateWorkflowRequest, EngineAccessControl, N8nImportRequest, RenameWorkflowRequest,
        RunDetailResponse, RunPageResponse, TriggerError, UpdateConnectorRecordRequest,
        WebhookSignatureAuth, WebhookWorkflow,
    };
    use crate::{
        connectors::install_starter_connector_pack,
        engine::{compile_workflow, ExecutionConfig, WorkflowEngine},
        models::{Step, Trigger, Workflow},
        nodes::{BuiltInNodeConfig, NodeRegistry},
        product_state::{
            connector_state_from_facts, latest_workflow_telemetry, ConnectorInstallValidityState,
            ConnectorRuntimeMode, ConnectorStateFacts, ConnectorValidityState,
            WorkflowConnectorRequirementsState, WorkflowFacts, WorkflowLifecycleState,
            WorkflowTelemetryFacts, WorkflowValidationState,
        },
        starter_connector_packs::starter_connector_pack,
        storage::{NewAssetRecord, NewConnectorRecord, NewNodeRecord, RunRecord, RunStore},
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
    fn accepts_engine_auth_token_from_bearer_or_custom_header() {
        let mut bearer_headers = HeaderMap::new();
        bearer_headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer demo-token"));
        assert!(request_has_engine_token(&bearer_headers, "demo-token"));

        let mut custom_headers = HeaderMap::new();
        custom_headers.insert("x-acsa-engine-token", HeaderValue::from_static("demo-token"));
        assert!(request_has_engine_token(&custom_headers, "demo-token"));
    }

    #[test]
    fn rejects_invalid_engine_auth_token() {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer wrong-token"));
        assert!(!request_has_engine_token(&headers, "demo-token"));
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
    fn node_catalog_uses_product_facing_categories_and_labels_for_built_in_steps() {
        let temp_dir = write_temp_directory("node-catalog-language");
        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let (steps, _triggers) = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            node_catalog(&store, &temp_dir).await.expect("catalog should load")
        });

        let by_type_name = |type_name: &str| {
            steps.iter().find(|entry| entry.type_name == type_name).unwrap_or_else(|| {
                panic!(
                    "built-in step {type_name} should exist; got {:?}",
                    steps.iter().map(|entry| entry.type_name.as_str()).collect::<Vec<_>>()
                )
            })
        };

        assert_eq!(by_type_name("constant").category, "Data");
        assert_eq!(by_type_name("noop").label, "Pass through");
        assert_eq!(by_type_name("condition").category, "Flow");
        assert_eq!(by_type_name("database_query").category, "Data");
        assert_eq!(by_type_name("embedding").label, "Store knowledge");
        assert_eq!(by_type_name("retrieval").label, "Find related knowledge");
        assert_eq!(by_type_name("manual_input").category, "Human");
        assert_eq!(by_type_name("http_request").category, "Apps");

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn shipped_asset_seeding_creates_built_in_and_starter_connector_assets() {
        let temp_dir = write_temp_directory("shipped-asset-seeding");
        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            ensure_shipped_asset_records(&store).await.expect("asset seeding should succeed");

            let assets = store.list_asset_records().await.expect("assets should list");
            assert!(assets.iter().any(|asset| {
                asset.asset_kind == "node"
                    && asset.type_name == "constant"
                    && asset.source_kind == "shipped"
            }));
            assert!(assets.iter().any(|asset| {
                asset.asset_kind == "connector"
                    && asset.type_name == "slack_notify"
                    && asset.source_ref.as_deref() == Some("slack-notify")
            }));
        });

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[tokio::test]
    async fn repo_authored_connector_sync_copies_bundle_into_asset_store() {
        let temp_dir = write_temp_directory("repo-connector-sync");
        let db_path = temp_dir.join("runs.sqlite");
        let repo_connectors_dir = temp_dir.join("repo-connectors");
        let source_connector_dir = repo_connectors_dir.join("ship-demo");
        std::fs::create_dir_all(&source_connector_dir).expect("source connector dir should exist");
        std::fs::write(
            source_connector_dir.join("manifest.json"),
            r#"{
  "name": "Ship Demo",
  "type": "ship_demo",
  "runtime": "process",
  "entry": "python3 main.py",
  "outputs": ["ok"],
  "limits": { "timeout": 1000 }
}"#,
        )
        .expect("manifest should write");
        std::fs::write(source_connector_dir.join("main.py"), "print('ok')\n")
            .expect("connector code should write");

        let store = RunStore::connect(&db_path).await.expect("store should connect");
        sync_repo_authored_connector_assets(&store, &repo_connectors_dir)
            .await
            .expect("repo-authored connector sync should succeed");

        let connector_record = store
            .get_connector_record_by_type("ship_demo")
            .await
            .expect("connector record should persist");
        let asset_record = store
            .get_asset_record("connector", "ship_demo")
            .await
            .expect("asset record should persist");

        assert_eq!(connector_record.source_kind, "shipped");
        assert_eq!(asset_record.source_kind, "shipped");
        assert!(store
            .asset_store_connectors_dir()
            .join("ship-demo")
            .join("manifest.json")
            .exists());
        assert!(std::path::Path::new(&connector_record.connector_dir).ends_with("ship-demo"));

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[tokio::test]
    async fn repo_authored_connector_sync_keeps_locally_modified_shipped_bundle() {
        let temp_dir = write_temp_directory("repo-connector-sync-local-modified");
        let db_path = temp_dir.join("runs.sqlite");
        let repo_connectors_dir = temp_dir.join("repo-connectors");
        let source_connector_dir = repo_connectors_dir.join("ship-demo");
        std::fs::create_dir_all(&source_connector_dir).expect("source connector dir should exist");
        std::fs::write(
            source_connector_dir.join("manifest.json"),
            r#"{
  "name": "Ship Demo",
  "type": "ship_demo",
  "runtime": "process",
  "entry": "python3 main.py",
  "outputs": ["ok"],
  "limits": { "timeout": 1000 }
}"#,
        )
        .expect("manifest should write");
        std::fs::write(source_connector_dir.join("main.py"), "print('repo-v1')\n")
            .expect("connector code should write");

        let store = RunStore::connect(&db_path).await.expect("store should connect");
        sync_repo_authored_connector_assets(&store, &repo_connectors_dir)
            .await
            .expect("initial sync should succeed");

        let stored_connector_main =
            store.asset_store_connectors_dir().join("ship-demo").join("main.py");
        std::fs::write(&stored_connector_main, "print('local-edit')\n")
            .expect("local modification should write");
        let existing_asset = store
            .get_asset_record("connector", "ship_demo")
            .await
            .expect("asset record should exist");
        store
            .upsert_asset_record(NewAssetRecord {
                asset_kind: "connector",
                type_name: &existing_asset.type_name,
                name: &existing_asset.name,
                description: &existing_asset.description,
                category: existing_asset.category.as_deref(),
                runtime: existing_asset.runtime.as_deref(),
                source_kind: &existing_asset.source_kind,
                source_ref: existing_asset.source_ref.as_deref(),
                definition_json: &existing_asset.definition_json,
                installed_version: existing_asset.installed_version.as_deref(),
                available_version: existing_asset.available_version.as_deref(),
                is_locally_modified: true,
            })
            .await
            .expect("asset record should mark local modification");
        std::fs::write(source_connector_dir.join("main.py"), "print('repo-v2')\n")
            .expect("repo update should write");

        sync_repo_authored_connector_assets(&store, &repo_connectors_dir)
            .await
            .expect("second sync should succeed");

        assert_eq!(
            std::fs::read_to_string(&stored_connector_main).expect("stored connector should read"),
            "print('local-edit')\n"
        );

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn node_catalog_prefers_shipped_asset_registry_metadata_for_built_ins() {
        let temp_dir = write_temp_directory("node-catalog-shipped-asset-overrides");
        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let (steps, _triggers) = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            store
                .upsert_asset_record(NewAssetRecord {
                    asset_kind: "node",
                    type_name: "constant",
                    name: "Compose value",
                    description: "Compose a reusable value for later steps.",
                    category: Some("Data"),
                    runtime: None,
                    source_kind: "shipped",
                    source_ref: Some("built_in"),
                    definition_json: r#"{"type":"constant"}"#,
                    installed_version: Some("1.0.0"),
                    available_version: Some("1.0.0"),
                    is_locally_modified: true,
                })
                .await
                .expect("asset record should persist");
            node_catalog(&store, &temp_dir).await.expect("catalog should load")
        });

        let constant = steps
            .iter()
            .find(|entry| entry.type_name == "constant")
            .expect("constant step should exist");
        assert_eq!(constant.label, "Compose value");
        assert_eq!(constant.description, "Compose a reusable value for later steps.");

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn node_catalog_uses_outcome_language_for_built_in_triggers() {
        let temp_dir = write_temp_directory("node-catalog-trigger-language");
        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let (_steps, triggers) = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            node_catalog(&store, &temp_dir).await.expect("catalog should load")
        });

        let by_type_name = |type_name: &str| {
            triggers
                .iter()
                .find(|entry| entry.type_name == type_name)
                .expect("built-in trigger should exist")
        };

        assert_eq!(by_type_name("manual").label, "Run manually");
        assert_eq!(by_type_name("cron").label, "Run on a schedule");
        assert_eq!(by_type_name("webhook").label, "Receive webhook");
        assert_eq!(
            by_type_name("webhook").description,
            "Start workflows from authenticated HTTP requests."
        );

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn node_catalog_exposes_app_record_metadata() {
        let temp_dir = write_temp_directory("node-catalog-app-record");
        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let (steps, _triggers) = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            store
                .upsert_node_record(NewNodeRecord {
                    type_name: "llm_completion",
                    label: "Write summary",
                    description: "Generate a short summary for downstream steps.",
                    category: "AI",
                    source_kind: "generated",
                    source_ref: Some("prompt:demo"),
                })
                .await
                .expect("node record should persist");
            node_catalog(&store, &temp_dir).await.expect("catalog should load")
        });

        let llm_step = steps
            .iter()
            .find(|entry| entry.type_name == "llm_completion")
            .expect("llm step should exist");
        let payload = serde_json::to_value(llm_step).expect("step should serialize");

        assert_eq!(payload["app_record"]["source_kind"], json!("generated"));
        assert_eq!(payload["app_record"]["source_ref"], json!("prompt:demo"));

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn node_catalog_includes_standalone_generated_node_records() {
        let temp_dir = write_temp_directory("node-catalog-standalone-record");
        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let (steps, _triggers) = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            store
                .upsert_node_record(NewNodeRecord {
                    type_name: "send_whatsapp_message",
                    label: "Send WhatsApp message",
                    description: "Send a WhatsApp message to a contact.",
                    category: "Apps",
                    source_kind: "generated",
                    source_ref: Some("n8n:send-email"),
                })
                .await
                .expect("node record should persist");
            node_catalog(&store, &temp_dir).await.expect("catalog should load")
        });

        let generated_step = steps
            .iter()
            .find(|entry| entry.type_name == "send_whatsapp_message")
            .expect("generated step should exist");
        assert_eq!(generated_step.label, "Send WhatsApp message");
        assert_eq!(generated_step.source, "generated");
        assert_eq!(
            generated_step.app_record.as_ref().map(|record| record.source_ref.as_deref()),
            Some(Some("n8n:send-email"))
        );

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn node_catalog_exposes_generated_node_base_type_metadata() {
        let temp_dir = write_temp_directory("node-catalog-base-type");
        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let (steps, _triggers) = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            store
                .upsert_node_record(NewNodeRecord {
                    type_name: "send_whatsapp_message",
                    label: "Send WhatsApp message",
                    description: "Send a WhatsApp message to a contact.",
                    category: "Apps",
                    source_kind: "generated",
                    source_ref: Some("prompt:whatsapp"),
                })
                .await
                .expect("node record should persist");
            store
                .upsert_asset_record(NewAssetRecord {
                    asset_kind: "node",
                    type_name: "send_whatsapp_message",
                    name: "Send WhatsApp message",
                    description: "Send a WhatsApp message to a contact.",
                    category: Some("Apps"),
                    runtime: Some("alias"),
                    source_kind: "generated",
                    source_ref: Some("prompt:whatsapp"),
                    definition_json:
                        r#"{"kind":"alias","base_type":"http_request","default_params":{}}"#,
                    installed_version: None,
                    available_version: None,
                    is_locally_modified: false,
                })
                .await
                .expect("asset record should persist");
            node_catalog(&store, &temp_dir).await.expect("catalog should load")
        });

        let generated_step = steps
            .iter()
            .find(|entry| entry.type_name == "send_whatsapp_message")
            .expect("generated step should exist");
        let payload = serde_json::to_value(generated_step).expect("step should serialize");

        assert_eq!(payload["app_record"]["base_type_name"], json!("http_request"));

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[tokio::test]
    async fn starter_pack_inventory_exposes_curated_pack_install_state() {
        let temp_dir = write_temp_directory("starter-pack-inventory");
        let state = starter_pack_test_state(&temp_dir).await;
        let pack = starter_connector_pack("slack-notify")
            .expect("starter pack lookup should succeed")
            .expect("starter pack should exist");
        install_starter_connector_pack(&state.engine.store().asset_store_connectors_dir(), &pack)
            .expect("starter pack should install");

        let response = list_starter_connector_packs(AxumState(state.clone())).await.into_response();

        assert_eq!(response.status(), StatusCode::OK);
        let payload =
            to_bytes(response.into_body(), usize::MAX).await.expect("response body should read");
        let payload: serde_json::Value =
            serde_json::from_slice(&payload).expect("starter pack inventory should deserialize");
        let packs = payload.as_array().expect("starter pack inventory should be an array");
        let slack_pack = packs
            .iter()
            .find(|pack| pack["id"] == "slack-notify")
            .expect("slack starter pack should exist");
        assert_eq!(slack_pack["installed"], json!(true));
        assert_eq!(slack_pack["install_state"], json!("satisfied"));
        assert_eq!(slack_pack["provided_step_types"], json!(["slack_notify"]));

        let github_pack = packs
            .iter()
            .find(|pack| pack["id"] == "github-issue-create")
            .expect("github starter pack should exist");
        assert_eq!(github_pack["installed"], json!(false));
        assert_eq!(github_pack["install_state"], json!("available"));

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[tokio::test]
    async fn install_starter_pack_endpoint_copies_connector_and_returns_updated_state() {
        let temp_dir = write_temp_directory("starter-pack-install");
        let state = starter_pack_test_state(&temp_dir).await;

        let response = install_starter_connector_pack_endpoint(
            AxumState(state.clone()),
            AxumPath("github-issue-create".to_string()),
        )
        .await
        .into_response();

        assert_eq!(response.status(), StatusCode::OK);
        let payload =
            to_bytes(response.into_body(), usize::MAX).await.expect("response body should read");
        let payload: serde_json::Value =
            serde_json::from_slice(&payload).expect("starter pack install should deserialize");
        assert_eq!(payload["id"], json!("github-issue-create"));
        assert_eq!(payload["installed"], json!(true));
        assert_eq!(payload["install_state"], json!("satisfied"));
        assert!(state
            .engine
            .store()
            .asset_store_connectors_dir()
            .join("github-issue-create")
            .join("manifest.json")
            .exists());

        let second_response = install_starter_connector_pack_endpoint(
            AxumState(state.clone()),
            AxumPath("github-issue-create".to_string()),
        )
        .await
        .into_response();

        assert_eq!(second_response.status(), StatusCode::OK);
        let second_payload = to_bytes(second_response.into_body(), usize::MAX)
            .await
            .expect("response body should read");
        let second_payload: serde_json::Value = serde_json::from_slice(&second_payload)
            .expect("starter pack install should deserialize");
        assert_eq!(second_payload["installed"], json!(true));
        assert_eq!(second_payload["install_state"], json!("satisfied"));

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[tokio::test]
    async fn install_starter_pack_endpoint_persists_connector_record() {
        let temp_dir = write_temp_directory("starter-pack-record");
        let state = starter_pack_test_state(&temp_dir).await;

        let response = install_starter_connector_pack_endpoint(
            AxumState(state.clone()),
            AxumPath("github-issue-create".to_string()),
        )
        .await
        .into_response();

        assert_eq!(response.status(), StatusCode::OK);
        let record = state
            .engine
            .store()
            .get_connector_record_by_type("github_issue_create")
            .await
            .expect("starter pack connector record should persist");
        assert_eq!(record.name, "GitHub Issue Create");
        assert_eq!(record.source_kind, "starter_pack");
        assert_eq!(record.source_ref.as_deref(), Some("github-issue-create"));
        assert!(record.connector_dir.ends_with("github-issue-create"));

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[tokio::test]
    async fn create_connector_persists_connector_record() {
        let temp_dir = write_temp_directory("create-connector-record");
        let state = starter_pack_test_state(&temp_dir).await;

        let response = create_connector(
            AxumState(state.clone()),
            Json(CreateConnectorRequest {
                name: "Sample Echo".to_string(),
                runtime: "process".to_string(),
                type_id: "sample_echo".to_string(),
            }),
        )
        .await
        .into_response();

        assert_eq!(response.status(), StatusCode::CREATED);
        let record = state
            .engine
            .store()
            .get_connector_record_by_type("sample_echo")
            .await
            .expect("scaffolded connector record should persist");
        assert_eq!(record.name, "Sample Echo");
        assert_eq!(record.source_kind, "custom");
        assert_eq!(record.source_ref, None);
        assert!(record.manifest_json.contains("\"type\":\"sample_echo\""));

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[tokio::test]
    async fn update_connector_record_updates_asset_metadata_and_marks_local_modification() {
        let temp_dir = write_temp_directory("update-connector-record");
        let state = starter_pack_test_state(&temp_dir).await;

        let create_response = create_connector(
            AxumState(state.clone()),
            Json(CreateConnectorRequest {
                name: "Sample Echo".to_string(),
                runtime: "process".to_string(),
                type_id: "sample_echo".to_string(),
            }),
        )
        .await
        .into_response();
        assert_eq!(create_response.status(), StatusCode::CREATED);

        let update_response = update_connector_record(
            AxumState(state.clone()),
            AxumPath("sample_echo".to_string()),
            Json(UpdateConnectorRecordRequest {
                name: "Echo requests".to_string(),
                description: "Echo a request payload back for testing.".to_string(),
            }),
        )
        .await
        .into_response();

        assert_eq!(update_response.status(), StatusCode::OK);

        let connector_record = state
            .engine
            .store()
            .get_connector_record_by_type("sample_echo")
            .await
            .expect("connector record should exist");
        assert_eq!(connector_record.name, "Echo requests");

        let asset_record = state
            .engine
            .store()
            .get_asset_record("connector", "sample_echo")
            .await
            .expect("asset record should exist");
        assert_eq!(asset_record.name, "Echo requests");
        assert_eq!(asset_record.description, "Echo a request payload back for testing.");
        assert!(asset_record.is_locally_modified);

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[tokio::test]
    async fn import_n8n_workflow_endpoint_returns_translation_payload() {
        let response = import_n8n_workflow(Json(N8nImportRequest {
            workflow_json: json!({
                "name": "Customer Intake",
                "nodes": [
                    {
                        "name": "Manual Trigger",
                        "type": "n8n-nodes-base.manualTrigger",
                        "parameters": {}
                    },
                    {
                        "name": "Fetch API",
                        "type": "n8n-nodes-base.httpRequest",
                        "parameters": {
                            "method": "GET",
                            "url": "https://example.com/health"
                        }
                    }
                ],
                "connections": {
                    "Manual Trigger": {
                        "main": [[{ "node": "Fetch API", "type": "main", "index": 0 }]]
                    }
                }
            }),
        }))
        .await
        .into_response();

        assert_eq!(response.status(), StatusCode::OK);
        let payload =
            to_bytes(response.into_body(), usize::MAX).await.expect("response body should read");
        let payload: serde_json::Value =
            serde_json::from_slice(&payload).expect("import response should deserialize");
        assert_eq!(payload["workflow_id"], json!("customer-intake"));
        assert_eq!(payload["workflow_name"], json!("Customer Intake"));
        assert_eq!(payload["report"]["blocked"], json!([]));
        assert_eq!(payload["report"]["degraded"], json!([]));
        assert!(payload["yaml"]
            .as_str()
            .expect("yaml should be rendered as a string")
            .contains("type: http_request"));
    }

    #[tokio::test]
    async fn import_n8n_workflow_endpoint_reports_trigger_only_workflows_as_blocked() {
        let response = import_n8n_workflow(Json(N8nImportRequest {
            workflow_json: json!({
                "name": "Trigger Only",
                "nodes": [
                    {
                        "name": "Manual Trigger",
                        "type": "n8n-nodes-base.manualTrigger",
                        "parameters": {}
                    }
                ],
                "connections": {}
            }),
        }))
        .await
        .into_response();

        assert_eq!(response.status(), StatusCode::OK);
        let payload =
            to_bytes(response.into_body(), usize::MAX).await.expect("response body should read");
        let payload: serde_json::Value =
            serde_json::from_slice(&payload).expect("import response should deserialize");
        assert_eq!(payload["yaml"], json!(""));
        assert!(payload["report"]["blocked"]
            .as_array()
            .expect("blocked report should be an array")
            .iter()
            .any(|item| item["message"]
                == json!("trigger-only workflows cannot be represented in Acsa today")));
    }

    #[tokio::test]
    async fn import_n8n_workflow_endpoint_rejects_non_object_payloads() {
        let response = import_n8n_workflow(Json(N8nImportRequest {
            workflow_json: json!(["not", "a", "workflow", "object"]),
        }))
        .await
        .into_response();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let payload =
            to_bytes(response.into_body(), usize::MAX).await.expect("response body should read");
        let payload: serde_json::Value =
            serde_json::from_slice(&payload).expect("error response should deserialize");
        assert!(payload["error"]
            .as_str()
            .expect("error should be rendered as a string")
            .contains("invalid n8n workflow payload"));
    }

    async fn starter_pack_test_state(temp_dir: &std::path::Path) -> AppState {
        let connectors_dir = temp_dir.join("connectors");
        let workflows_dir = temp_dir.join("workflows");
        std::fs::create_dir_all(&connectors_dir).expect("connectors dir should be created");
        std::fs::create_dir_all(&workflows_dir).expect("workflows dir should be created");

        let db_path = temp_dir.join("runs.sqlite");
        let store = RunStore::connect(&db_path).await.expect("run store should connect");
        let registry = NodeRegistry::built_in(BuiltInNodeConfig::default());
        let engine = WorkflowEngine::with_registry(store, registry, ExecutionConfig::default());

        AppState {
            access_control: EngineAccessControl { allow_remote: true, auth_token: None },
            connectors_dir,
            engine,
            webhook_workflows: std::sync::Arc::new(HashMap::new()),
            workflows_dir,
        }
    }

    #[test]
    fn rejects_workflow_ids_with_path_traversal_characters() {
        let error = validate_workflow_id("../bad-id").expect_err("workflow id should be rejected");

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
    fn workflow_state_separates_lifecycle_readiness_and_telemetry() {
        let workflow = Workflow {
            version: "v1".to_string(),
            name: "customer intake".to_string(),
            trigger: Trigger { r#type: "manual".to_string(), details: BTreeMap::new() },
            steps: vec![
                Step {
                    id: "start".to_string(),
                    r#type: "constant".to_string(),
                    params: serde_yaml::to_value(json!({ "value": true }))
                        .expect("json should convert to yaml"),
                    next: vec!["call-connector".to_string()],
                    retry: None,
                    timeout_ms: None,
                },
                Step {
                    id: "call-connector".to_string(),
                    r#type: "report-summary".to_string(),
                    params: serde_yaml::Value::Mapping(Default::default()),
                    next: vec![],
                    retry: None,
                    timeout_ms: None,
                },
            ],
            ui: Default::default(),
        };

        let summary = build_workflow_summary(
            "customer-intake".to_string(),
            &workflow,
            WorkflowFacts {
                lifecycle: WorkflowLifecycleState::Saved,
                validation_state: WorkflowValidationState::Valid,
                connector_requirements: WorkflowConnectorRequirementsState {
                    required_step_types: vec!["report-summary".to_string()],
                },
                connector_requirements_unmet: true,
                connector_runtime_blocked: false,
                connector_setup_blocked: false,
                latest_run: Some(WorkflowTelemetryFacts {
                    last_run_at: 1_710_850_000,
                    last_run_status: "success".to_string(),
                }),
            },
        );
        let payload = serde_json::to_value(summary).expect("summary should serialize");

        assert_eq!(payload["id"], json!("customer-intake"));
        assert_eq!(payload["name"], json!("customer intake"));
        assert_eq!(payload["file_name"], json!("customer-intake.yaml"));
        assert_eq!(payload["workflow_state"]["lifecycle"], json!("saved"));
        assert_eq!(payload["workflow_state"]["readiness"]["validation_state"], json!("valid"));
        assert_eq!(
            payload["workflow_state"]["readiness"]["connector_requirements"]["required_step_types"],
            json!(["report-summary"])
        );
        assert_eq!(
            payload["workflow_state"]["readiness"]["readiness_state"],
            json!("blocked_by_connector")
        );
        assert_eq!(payload["workflow_state"]["telemetry"]["last_run_status"], json!("success"));
        assert_eq!(payload["workflow_state"]["telemetry"]["last_run_at"], json!(1_710_850_000));
    }

    #[test]
    fn workflow_inventory_uses_latest_run_telemetry() {
        let temp_dir = write_temp_directory("workflow-inventory");
        let workflows_dir = temp_dir.join("workflows");
        let connectors_dir = temp_dir.join("connectors");
        std::fs::create_dir_all(&workflows_dir).expect("workflows dir should be created");
        std::fs::create_dir_all(&connectors_dir).expect("connectors dir should be created");

        std::fs::write(
            workflows_dir.join("customer-intake.yaml"),
            r#"
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
  - id: summarize
    type: report-summary
    params: {}
    next: []
"#,
        )
        .expect("workflow should be written");

        let connector_dir = connectors_dir.join("report-summary");
        std::fs::create_dir_all(&connector_dir).expect("connector dir should be created");
        std::fs::write(
            connector_dir.join("manifest.json"),
            r#"{
  "entry": "main.py",
  "inputs": ["payload"],
  "name": "Report Summary",
  "outputs": ["summary"],
  "runtime": "process",
  "type": "report-summary"
}"#,
        )
        .expect("manifest should be written");
        std::fs::write(connector_dir.join("README.md"), "# Report Summary\n")
            .expect("readme should be written");
        std::fs::write(connector_dir.join("sample-input.json"), "{}")
            .expect("sample input should be written");

        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let inventory = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            seed_workflows_from_directory_if_missing(&store, &workflows_dir)
                .await
                .expect("workflows should seed");
            let run = store
                .start_run(
                    "customer intake",
                    "sha256:exact-workflow",
                    "exact workflow snapshot",
                    Some("exact editor snapshot"),
                    &serde_json::json!({"value": true}),
                )
                .await
                .expect("run should start");
            store.complete_run_success(&run.id).await.expect("run should complete");

            workflow_inventory(&store, &connectors_dir, &workflows_dir)
                .await
                .expect("inventory should build")
        });
        let summary = inventory
            .workflows
            .into_iter()
            .find(|workflow| workflow.id == "customer-intake")
            .expect("workflow summary should exist");
        let payload = serde_json::to_value(summary).expect("summary should serialize");

        assert_eq!(payload["workflow_state"]["telemetry"]["last_run_status"], json!("success"));
        assert_ne!(payload["workflow_state"]["telemetry"]["last_run_at"], serde_json::Value::Null);

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn workflow_document_response_matches_inventory_state() {
        let temp_dir = write_temp_directory("workflow-document-state");
        let workflows_dir = temp_dir.join("workflows");
        let connectors_dir = temp_dir.join("connectors");
        std::fs::create_dir_all(&workflows_dir).expect("workflows dir should be created");
        std::fs::create_dir_all(&connectors_dir).expect("connectors dir should be created");

        std::fs::write(
            workflows_dir.join("customer-intake.yaml"),
            r#"
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
  - id: summarize
    type: report-summary
    params: {}
    next: []
"#,
        )
        .expect("workflow should be written");

        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let inventory = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            seed_workflows_from_directory_if_missing(&store, &workflows_dir)
                .await
                .expect("workflows should seed");
            let run = store
                .start_run(
                    "customer intake",
                    "sha256:exact-workflow",
                    "exact workflow snapshot",
                    Some("exact editor snapshot"),
                    &serde_json::json!({"value": true}),
                )
                .await
                .expect("run should start");
            store.complete_run_success(&run.id).await.expect("run should complete");

            let inventory = workflow_inventory(&store, &connectors_dir, &workflows_dir)
                .await
                .expect("inventory should build");
            let document =
                read_workflow_document(&store, &connectors_dir, &workflows_dir, "customer-intake")
                    .await
                    .expect("workflow document should read");
            (inventory, document)
        });

        let inventory_summary = inventory
            .0
            .workflows
            .into_iter()
            .find(|workflow| workflow.id == "customer-intake")
            .expect("inventory summary should exist");
        let document_payload =
            serde_json::to_value(inventory.1).expect("document response should serialize");

        assert_eq!(
            document_payload["summary"]["workflow_state"]["readiness"]["readiness_state"],
            serde_json::to_value(inventory_summary.workflow_state.readiness.readiness_state)
                .expect("inventory readiness should serialize")
        );
        assert_eq!(
            document_payload["summary"]["workflow_state"]["telemetry"]["last_run_status"],
            serde_json::to_value(inventory_summary.workflow_state.telemetry.last_run_status)
                .expect("inventory telemetry should serialize")
        );

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn create_workflow_response_reflects_blocked_connector_state() {
        let temp_dir = write_temp_directory("workflow-create-blocked-state");
        let workflows_dir = temp_dir.join("workflows");
        let connectors_dir = temp_dir.join("connectors");
        std::fs::create_dir_all(&workflows_dir).expect("workflows dir should be created");
        std::fs::create_dir_all(&connectors_dir).expect("connectors dir should be created");

        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let response = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            create_workflow_document(
                &store,
                &connectors_dir,
                &workflows_dir,
                CreateWorkflowRequest {
                    id: Some("customer-intake".to_string()),
                    yaml: r#"
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
  - id: summarize
    type: report-summary
    params: {}
    next: []
"#
                    .to_string(),
                },
            )
            .await
            .expect("workflow should be created")
        });

        let payload = serde_json::to_value(response).expect("response should serialize");
        assert_eq!(
            payload["summary"]["workflow_state"]["readiness"]["readiness_state"],
            json!("blocked_by_connector")
        );

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn create_workflow_response_allows_blank_workflows() {
        let temp_dir = write_temp_directory("workflow-create-blank-state");
        let workflows_dir = temp_dir.join("workflows");
        std::fs::create_dir_all(&workflows_dir).expect("workflows dir should be created");
        let connectors_dir = temp_dir.join("connectors");

        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let response = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            create_workflow_document(
                &store,
                &connectors_dir,
                &workflows_dir,
                CreateWorkflowRequest {
                    id: Some("blank-workflow".to_string()),
                    yaml: r#"
version: v1
name: blank workflow
trigger:
  type: manual
steps: []
"#
                    .to_string(),
                },
            )
            .await
            .expect("blank workflow should be created")
        });

        assert_eq!(response.id, "blank-workflow");
        let payload = serde_json::to_value(response).expect("response should serialize");
        assert_eq!(payload["summary"]["step_count"], json!(0));

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn workflow_inventory_classifies_invalid_installed_connector_as_setup_blocked() {
        let temp_dir = write_temp_directory("workflow-inventory-invalid-connector");
        let workflows_dir = temp_dir.join("workflows");
        let connectors_dir = temp_dir.join("connectors");
        std::fs::create_dir_all(&workflows_dir).expect("workflows dir should be created");
        std::fs::create_dir_all(&connectors_dir).expect("connectors dir should be created");

        std::fs::write(
            workflows_dir.join("customer-intake.yaml"),
            r#"
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
  - id: summarize
    type: broken-summary
    params: {}
    next: []
"#,
        )
        .expect("workflow should be written");

        let connector_dir = connectors_dir.join("broken-summary");
        std::fs::create_dir_all(&connector_dir).expect("connector dir should be created");
        std::fs::write(
            connector_dir.join("manifest.json"),
            r#"{
  "entry": "main.py",
  "inputs": ["payload"],
  "name": "Broken Summary",
  "outputs": ["summary"],
  "runtime": "process",
  "type": "broken-summary"
}"#,
        )
        .expect("invalid manifest should be written");
        std::fs::write(connector_dir.join("main.py"), "print('{}')").expect("script should exist");

        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let inventory = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            seed_workflows_from_directory_if_missing(&store, &workflows_dir)
                .await
                .expect("workflows should seed");
            workflow_inventory(&store, &connectors_dir, &workflows_dir)
                .await
                .expect("inventory should build")
        });

        let summary = inventory
            .workflows
            .into_iter()
            .find(|workflow| workflow.id == "customer-intake")
            .expect("workflow summary should exist");
        let payload = serde_json::to_value(summary).expect("summary should serialize");

        assert_eq!(
            payload["workflow_state"]["readiness"]["readiness_state"],
            json!("blocked_by_setup")
        );

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn workflow_inventory_prefers_valid_connector_over_invalid_same_type() {
        let temp_dir = write_temp_directory("workflow-inventory-valid-and-invalid-connector");
        let workflows_dir = temp_dir.join("workflows");
        let connectors_dir = temp_dir.join("connectors");
        std::fs::create_dir_all(&workflows_dir).expect("workflows dir should be created");
        std::fs::create_dir_all(&connectors_dir).expect("connectors dir should be created");

        std::fs::write(
            workflows_dir.join("customer-intake.yaml"),
            r#"
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
  - id: summarize
    type: report-summary
    params: {}
    next: []
"#,
        )
        .expect("workflow should be written");

        let valid_connector_dir = connectors_dir.join("report-summary-valid");
        std::fs::create_dir_all(&valid_connector_dir).expect("valid connector dir should exist");
        std::fs::write(
            valid_connector_dir.join("manifest.json"),
            r#"{
  "entry": "python3 main.py",
  "inputs": ["payload"],
  "limits": { "timeout": 1000 },
  "name": "Report Summary",
  "outputs": ["summary"],
  "runtime": "process",
  "type": "report-summary"
}"#,
        )
        .expect("valid manifest should be written");
        std::fs::write(valid_connector_dir.join("main.py"), "print('{}')")
            .expect("valid script should exist");

        let invalid_connector_dir = connectors_dir.join("report-summary-invalid");
        std::fs::create_dir_all(&invalid_connector_dir)
            .expect("invalid connector dir should exist");
        std::fs::write(
            invalid_connector_dir.join("manifest.json"),
            r#"{
  "entry": "python3 main.py",
  "inputs": ["payload"],
  "name": "Broken Report Summary",
  "outputs": ["summary"],
  "runtime": "process",
  "type": "report-summary"
}"#,
        )
        .expect("invalid manifest should be written");
        std::fs::write(invalid_connector_dir.join("main.py"), "print('{}')")
            .expect("invalid script should exist");

        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let inventory = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            seed_workflows_from_directory_if_missing(&store, &workflows_dir)
                .await
                .expect("workflows should seed");
            workflow_inventory(&store, &connectors_dir, &workflows_dir)
                .await
                .expect("inventory should build")
        });

        let summary = inventory
            .workflows
            .into_iter()
            .find(|workflow| workflow.id == "customer-intake")
            .expect("workflow summary should exist");
        let payload = serde_json::to_value(summary).expect("summary should serialize");

        assert_eq!(payload["workflow_state"]["readiness"]["readiness_state"], json!("ready"));

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn workflow_inventory_exposes_product_state() {
        let temp_dir = write_temp_directory("workflow-inventory-product-state");
        let workflows_dir = temp_dir.join("workflows");
        let connectors_dir = temp_dir.join("connectors");
        std::fs::create_dir_all(&workflows_dir).expect("workflows dir should be created");
        std::fs::create_dir_all(&connectors_dir).expect("connectors dir should be created");

        std::fs::write(
            workflows_dir.join("customer-intake.yaml"),
            r#"
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
  - id: summarize
    type: report-summary
    params: {}
    next: []
"#,
        )
        .expect("workflow should be written");

        let connector_dir = connectors_dir.join("report-summary");
        std::fs::create_dir_all(&connector_dir).expect("connector dir should be created");
        std::fs::write(
            connector_dir.join("manifest.json"),
            r#"{
  "entry": "main.py",
  "inputs": ["payload"],
  "limits": { "timeout": 1000 },
  "name": "Report Summary",
  "outputs": ["summary"],
  "runtime": "process",
  "type": "report-summary"
}"#,
        )
        .expect("manifest should be written");
        std::fs::write(connector_dir.join("main.py"), "print('{}')")
            .expect("script should be written");

        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let (inventory, saved_document, renamed_document) = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            seed_workflows_from_directory_if_missing(&store, &workflows_dir)
                .await
                .expect("workflows should seed");
            let run = store
                .start_run(
                    "customer intake",
                    "sha256:exact-workflow",
                    "exact workflow snapshot",
                    Some("exact editor snapshot"),
                    &serde_json::json!({"value": true}),
                )
                .await
                .expect("run should start");
            store.complete_run_success(&run.id).await.expect("run should complete");

            let inventory = workflow_inventory(&store, &connectors_dir, &workflows_dir)
                .await
                .expect("inventory should build");

            let saved_document = save_workflow_document(
                &store,
                &connectors_dir,
                &workflows_dir,
                "customer-intake",
                r#"
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
  - id: summarize
    type: report-summary
    params: {}
    next: []
"#,
            )
            .await
            .expect("workflow should save");

            let renamed_document = rename_workflow_document(
                &store,
                &connectors_dir,
                &workflows_dir,
                "customer-intake",
                RenameWorkflowRequest {
                    name: "customer intake".to_string(),
                    target_id: "customer-intake-renamed".to_string(),
                    yaml: None,
                },
            )
            .await
            .expect("workflow should rename");

            (inventory, saved_document, renamed_document)
        });

        let inventory_summary = inventory
            .workflows
            .into_iter()
            .find(|workflow| workflow.id == "customer-intake")
            .expect("workflow summary should exist");
        let inventory_payload =
            serde_json::to_value(inventory_summary).expect("summary should serialize");
        let saved_payload =
            serde_json::to_value(saved_document).expect("saved document should serialize");
        let renamed_payload =
            serde_json::to_value(renamed_document).expect("renamed document should serialize");

        assert_eq!(inventory_payload["workflow_state"]["lifecycle"], json!("saved"));
        assert_eq!(
            inventory_payload["workflow_state"]["readiness"]["connector_requirements"]
                ["required_step_types"],
            json!(["report-summary"])
        );
        assert_eq!(
            inventory_payload["workflow_state"]["telemetry"]["last_run_status"],
            json!("success")
        );
        assert_eq!(
            saved_payload["summary"]["workflow_state"]["readiness"]["connector_requirements"]
                ["required_step_types"],
            json!(["report-summary"])
        );
        assert_eq!(
            saved_payload["summary"]["workflow_state"]["telemetry"]["last_run_status"],
            json!("success")
        );
        assert_eq!(
            renamed_payload["summary"]["workflow_state"]["readiness"]["connector_requirements"]
                ["required_step_types"],
            json!(["report-summary"])
        );
        assert_eq!(
            renamed_payload["summary"]["workflow_state"]["telemetry"]["last_run_status"],
            json!("success")
        );

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn connector_inventory_exposes_product_state() {
        let temp_dir = write_temp_directory("connector-inventory-product-state");
        let workflows_dir = temp_dir.join("workflows");
        let connectors_dir = temp_dir.join("connectors");
        std::fs::create_dir_all(&workflows_dir).expect("workflows dir should be created");
        std::fs::create_dir_all(&connectors_dir).expect("connectors dir should be created");

        std::fs::write(
            workflows_dir.join("customer-intake.yaml"),
            r#"
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
  - id: summarize
    type: report-summary
    params: {}
    next: []
  - id: broken
    type: broken-summary
    params: {}
    next: []
"#,
        )
        .expect("workflow should be written");

        let valid_connector_dir = connectors_dir.join("report-summary");
        std::fs::create_dir_all(&valid_connector_dir).expect("valid connector dir should exist");
        std::fs::write(
            valid_connector_dir.join("manifest.json"),
            r#"{
  "entry": "main.py",
  "inputs": ["payload"],
  "limits": { "timeout": 1000 },
  "name": "Report Summary",
  "outputs": ["summary"],
  "runtime": "process",
  "type": "report-summary"
}"#,
        )
        .expect("valid manifest should be written");
        std::fs::write(valid_connector_dir.join("main.py"), "print('{}')")
            .expect("valid connector script should exist");

        let invalid_connector_dir = connectors_dir.join("broken-summary");
        std::fs::create_dir_all(&invalid_connector_dir)
            .expect("invalid connector dir should exist");
        std::fs::write(
            invalid_connector_dir.join("manifest.json"),
            r#"{
  "entry": "main.py",
  "inputs": ["payload"],
  "name": "Broken Summary",
  "outputs": ["summary"],
  "runtime": "process",
  "type": "broken-summary"
}"#,
        )
        .expect("invalid manifest should be written");
        std::fs::write(invalid_connector_dir.join("main.py"), "print('{}')")
            .expect("invalid connector script should exist");

        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let inventory = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            seed_workflows_from_directory_if_missing(&store, &workflows_dir)
                .await
                .expect("workflows should seed");
            connector_inventory(&store, &connectors_dir)
                .await
                .expect("connector inventory should build")
        });
        let valid_payload = serde_json::to_value(
            inventory
                .connectors
                .iter()
                .find(|connector| connector.type_name == "report-summary")
                .expect("valid connector should exist"),
        )
        .expect("valid connector should serialize");
        let invalid_payload = serde_json::to_value(
            inventory
                .invalid_connectors
                .iter()
                .find(|connector| connector.id == "broken-summary")
                .expect("invalid connector should exist"),
        )
        .expect("invalid connector should serialize");

        assert_eq!(valid_payload["provided_step_types"], json!(["report-summary"]));
        assert_eq!(valid_payload["used_by_workflows"], json!(["customer intake"]));
        assert_eq!(valid_payload["required_by_templates"], json!([]));
        assert_eq!(valid_payload["connector_state"]["install_validity"]["state"], json!("valid"));
        assert_eq!(invalid_payload["provided_step_types"], json!(["broken-summary"]));
        assert_eq!(invalid_payload["used_by_workflows"], json!(["customer intake"]));
        assert_eq!(invalid_payload["required_by_templates"], json!([]));
        assert_eq!(
            invalid_payload["connector_state"]["install_validity"]["state"],
            json!("invalid")
        );

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn connector_inventory_exposes_app_record_metadata() {
        let temp_dir = write_temp_directory("connector-inventory-app-record");
        let connectors_dir = temp_dir.join("connectors");
        std::fs::create_dir_all(&connectors_dir).expect("connectors dir should be created");

        let valid_connector_dir = connectors_dir.join("report-summary");
        std::fs::create_dir_all(&valid_connector_dir).expect("valid connector dir should exist");
        std::fs::write(
            valid_connector_dir.join("manifest.json"),
            r#"{
  "entry": "main.py",
  "inputs": ["payload"],
  "limits": { "timeout": 1000 },
  "name": "Report Summary",
  "outputs": ["summary"],
  "runtime": "process",
  "type": "report-summary"
}"#,
        )
        .expect("valid manifest should be written");
        std::fs::write(valid_connector_dir.join("main.py"), "print('{}')")
            .expect("valid connector script should exist");

        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let inventory = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            store
                .upsert_connector_record(NewConnectorRecord {
                    type_name: "report-summary",
                    name: "Report Summary",
                    runtime: "process",
                    source_kind: "starter_pack",
                    source_ref: Some("report-summary-pack"),
                    connector_dir: &valid_connector_dir.display().to_string(),
                    manifest_path: &valid_connector_dir.join("manifest.json").display().to_string(),
                    manifest_json: r#"{"type":"report-summary"}"#,
                })
                .await
                .expect("connector record should persist");

            connector_inventory(&store, &connectors_dir)
                .await
                .expect("connector inventory should build")
        });

        let valid_payload = serde_json::to_value(
            inventory
                .connectors
                .iter()
                .find(|connector| connector.type_name == "report-summary")
                .expect("valid connector should exist"),
        )
        .expect("valid connector should serialize");

        assert_eq!(valid_payload["app_record"]["source_kind"], json!("starter_pack"));
        assert_eq!(valid_payload["app_record"]["source_ref"], json!("report-summary-pack"));
        assert_eq!(valid_payload["app_record"]["is_locally_modified"], json!(false));

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn connector_inventory_prefers_asset_metadata_and_exposes_update_state() {
        let temp_dir = write_temp_directory("connector-inventory-asset-metadata");
        let connectors_dir = temp_dir.join("connectors");
        std::fs::create_dir_all(&connectors_dir).expect("connectors dir should be created");

        let connector_dir = connectors_dir.join("report-summary");
        std::fs::create_dir_all(&connector_dir).expect("connector dir should exist");
        std::fs::write(
            connector_dir.join("manifest.json"),
            r#"{
  "entry": "main.py",
  "inputs": ["payload"],
  "limits": { "timeout": 1000 },
  "name": "Report Summary",
  "outputs": ["summary"],
  "runtime": "process",
  "type": "report-summary",
  "version": "1.0.0"
}"#,
        )
        .expect("manifest should be written");
        std::fs::write(connector_dir.join("main.py"), "print('{}')\n")
            .expect("connector code should be written");

        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let inventory = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            store
                .upsert_connector_record(NewConnectorRecord {
                    type_name: "report-summary",
                    name: "Report Summary",
                    runtime: "process",
                    source_kind: "starter_pack",
                    source_ref: Some("report-summary-pack"),
                    connector_dir: &connector_dir.display().to_string(),
                    manifest_path: &connector_dir.join("manifest.json").display().to_string(),
                    manifest_json: r#"{"type":"report-summary"}"#,
                })
                .await
                .expect("connector record should persist");
            store
                .upsert_asset_record(NewAssetRecord {
                    asset_kind: "connector",
                    type_name: "report-summary",
                    name: "Custom Report Summary",
                    description: "Summarize the latest report payload.",
                    category: Some("Apps"),
                    runtime: Some("process"),
                    source_kind: "starter_pack",
                    source_ref: Some("report-summary-pack"),
                    definition_json: r#"{"type":"report-summary"}"#,
                    installed_version: Some("1.0.0"),
                    available_version: Some("1.1.0"),
                    is_locally_modified: true,
                })
                .await
                .expect("asset record should persist");

            connector_inventory(&store, &connectors_dir)
                .await
                .expect("connector inventory should build")
        });

        let payload = serde_json::to_value(
            inventory
                .connectors
                .iter()
                .find(|connector| connector.type_name == "report-summary")
                .expect("connector should exist"),
        )
        .expect("connector should serialize");

        assert_eq!(payload["name"], json!("Custom Report Summary"));
        assert_eq!(payload["description"], json!("Summarize the latest report payload."));
        assert_eq!(payload["app_record"]["installed_version"], json!("1.0.0"));
        assert_eq!(payload["app_record"]["available_version"], json!("1.1.0"));
        assert_eq!(payload["app_record"]["is_locally_modified"], json!(true));

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn create_workflow_succeeds_when_post_write_summary_enrichment_fails() {
        let temp_dir = write_temp_directory("workflow-create-summary-fallback");
        let workflows_dir = temp_dir.join("workflows");
        std::fs::create_dir_all(&workflows_dir).expect("workflows dir should be created");
        let connectors_dir = temp_dir.join("missing-connectors");

        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let response = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            create_workflow_document(
                &store,
                &connectors_dir,
                &workflows_dir,
                CreateWorkflowRequest {
                    id: Some("customer-intake".to_string()),
                    yaml: r#"
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
"#
                    .to_string(),
                },
            )
            .await
            .expect("workflow should still be created")
        });

        assert_eq!(response.id, "customer-intake");
        let persisted = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should reconnect");
            store.get_workflow("customer-intake").await.expect("workflow should persist in db")
        });
        assert_eq!(persisted.name, "customer intake");
        let payload = serde_json::to_value(response).expect("response should serialize");
        assert_eq!(
            payload["summary"]["workflow_state"]["readiness"]["readiness_state"],
            json!("ready")
        );

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn workflow_inventory_omits_telemetry_for_duplicate_workflow_names() {
        let temp_dir = write_temp_directory("workflow-inventory-duplicate-names");
        let workflows_dir = temp_dir.join("workflows");
        let connectors_dir = temp_dir.join("connectors");
        std::fs::create_dir_all(&workflows_dir).expect("workflows dir should be created");
        std::fs::create_dir_all(&connectors_dir).expect("connectors dir should be created");

        for workflow_id in ["first-workflow", "second-workflow"] {
            std::fs::write(
                workflows_dir.join(format!("{workflow_id}.yaml")),
                r#"
version: v1
name: duplicate workflow
trigger:
  type: manual
steps:
  - id: start
    type: constant
    params:
      value: true
    next: []
"#,
            )
            .expect("workflow should be written");
        }

        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let inventory = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            seed_workflows_from_directory_if_missing(&store, &workflows_dir)
                .await
                .expect("workflows should seed");
            let run = store
                .start_run(
                    "duplicate workflow",
                    "sha256:exact-workflow",
                    "exact workflow snapshot",
                    Some("exact editor snapshot"),
                    &serde_json::json!({"value": true}),
                )
                .await
                .expect("run should start");
            store.complete_run_success(&run.id).await.expect("run should complete");

            workflow_inventory(&store, &connectors_dir, &workflows_dir)
                .await
                .expect("inventory should build")
        });

        let summaries: Vec<_> = inventory
            .workflows
            .iter()
            .filter(|workflow| workflow.name == "duplicate workflow")
            .collect();
        assert_eq!(summaries.len(), 2);
        for summary in summaries {
            let payload = serde_json::to_value(summary).expect("summary should serialize");
            assert_eq!(
                payload["workflow_state"]["telemetry"]["last_run_status"],
                serde_json::Value::Null
            );
            assert_eq!(
                payload["workflow_state"]["telemetry"]["last_run_at"],
                serde_json::Value::Null
            );
        }

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn latest_workflow_telemetry_prefers_newest_run_by_started_at() {
        let telemetry = latest_workflow_telemetry(vec![
            RunRecord {
                id: "older".to_string(),
                workflow_name: "customer intake".to_string(),
                status: "failed".to_string(),
                started_at: 10,
                finished_at: Some(11),
                error_message: Some("boom".to_string()),
                workflow_revision: Some("sha256:older".to_string()),
                editor_snapshot: None,
                workflow_snapshot: Some("saved workflow".to_string()),
                initial_payload: None,
                state_json: None,
            },
            RunRecord {
                id: "newer".to_string(),
                workflow_name: "customer intake".to_string(),
                status: "success".to_string(),
                started_at: 20,
                finished_at: Some(21),
                error_message: None,
                workflow_revision: Some("sha256:newer".to_string()),
                editor_snapshot: None,
                workflow_snapshot: Some("saved workflow".to_string()),
                initial_payload: None,
                state_json: None,
            },
        ]);

        let latest = telemetry.get("customer intake").expect("latest telemetry should exist");
        assert_eq!(latest.last_run_status, "success");
        assert_eq!(latest.last_run_at, 21);
    }

    #[test]
    fn latest_workflow_telemetry_breaks_started_at_ties_with_richer_facts() {
        let telemetry = latest_workflow_telemetry(vec![
            RunRecord {
                id: "run-a".to_string(),
                workflow_name: "customer intake".to_string(),
                status: "failed".to_string(),
                started_at: 42,
                finished_at: Some(43),
                error_message: Some("older run".to_string()),
                workflow_revision: Some("sha256:run-a".to_string()),
                editor_snapshot: None,
                workflow_snapshot: None,
                initial_payload: None,
                state_json: None,
            },
            RunRecord {
                id: "run-b".to_string(),
                workflow_name: "customer intake".to_string(),
                status: "success".to_string(),
                started_at: 42,
                finished_at: Some(44),
                error_message: None,
                workflow_revision: Some("sha256:run-b".to_string()),
                editor_snapshot: Some("editor snapshot".to_string()),
                workflow_snapshot: Some("workflow snapshot".to_string()),
                initial_payload: None,
                state_json: Some("{\"state\":\"paused\"}".to_string()),
            },
        ]);

        let latest = telemetry.get("customer intake").expect("latest telemetry should exist");
        assert_eq!(latest.last_run_status, "success");
        assert_eq!(latest.last_run_at, 44);
    }

    #[test]
    fn workflow_inventory_pages_past_the_old_ten_thousand_run_cap() {
        let temp_dir = write_temp_directory("workflow-inventory-cap");
        let workflows_dir = temp_dir.join("workflows");
        let connectors_dir = temp_dir.join("connectors");
        std::fs::create_dir_all(&workflows_dir).expect("workflows dir should be created");
        std::fs::create_dir_all(&connectors_dir).expect("connectors dir should be created");

        std::fs::write(
            workflows_dir.join("bulk-workflow.yaml"),
            r#"
version: v1
name: bulk workflow
trigger:
  type: manual
steps:
  - id: start
    type: constant
    params:
      value: true
    next: []
"#,
        )
        .expect("bulk workflow should be written");
        std::fs::write(
            workflows_dir.join("target-workflow.yaml"),
            r#"
version: v1
name: target workflow
trigger:
  type: manual
steps:
  - id: start
    type: constant
    params:
      value: true
    next: []
"#,
        )
        .expect("target workflow should be written");

        let db_path = temp_dir.join("runs.sqlite");
        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let inventory = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            seed_workflows_from_directory_if_missing(&store, &workflows_dir)
                .await
                .expect("workflows should seed");

            for index in 0..10_000 {
                sqlx::query(
                    r#"
                    INSERT INTO runs (
                      id,
                      workflow_name,
                      status,
                      started_at,
                      finished_at,
                      error_message,
                      editor_snapshot,
                      workflow_snapshot,
                      initial_payload,
                      state_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    "#,
                )
                .bind(format!("bulk-run-{index}"))
                .bind("bulk workflow")
                .bind("success")
                .bind(10_000_i64 + index as i64)
                .bind(Some(10_000_i64 + index as i64))
                .bind(Option::<String>::None)
                .bind(Some("historical editor snapshot"))
                .bind(Some("saved workflow snapshot"))
                .bind(Option::<String>::None)
                .bind(Option::<String>::None)
                .execute(store.pool())
                .await
                .expect("bulk run should insert");
            }

            sqlx::query(
                r#"
                INSERT INTO runs (
                  id,
                  workflow_name,
                  status,
                  started_at,
                  finished_at,
                  error_message,
                  editor_snapshot,
                  workflow_snapshot,
                  initial_payload,
                  state_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind("target-run")
            .bind("target workflow")
            .bind("success")
            .bind(1_i64)
            .bind(Some(1_i64))
            .bind(Option::<String>::None)
            .bind(Some("historical editor snapshot"))
            .bind(Some("saved workflow snapshot"))
            .bind(Option::<String>::None)
            .bind(Option::<String>::None)
            .execute(store.pool())
            .await
            .expect("target run should insert");

            workflow_inventory(&store, &connectors_dir, &workflows_dir)
                .await
                .expect("inventory should build")
        });

        let summary = inventory
            .workflows
            .into_iter()
            .find(|workflow| workflow.id == "target-workflow")
            .expect("target workflow summary should exist");
        let payload = serde_json::to_value(summary).expect("summary should serialize");
        assert_eq!(payload["workflow_state"]["telemetry"]["last_run_status"], json!("success"));
        assert_ne!(payload["workflow_state"]["telemetry"]["last_run_at"], serde_json::Value::Null);

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn connector_state_reports_install_validity_runtime_and_setup() {
        let temp_dir = write_temp_directory("connector-state");
        let connector_dir = temp_dir.join("report-summary");
        std::fs::create_dir_all(&connector_dir).expect("connector dir should be created");
        let manifest_path = connector_dir.join("manifest.json");
        let readme_path = connector_dir.join("README.md");
        let sample_input_path = connector_dir.join("sample-input.json");
        std::fs::write(
            &manifest_path,
            r#"{
  "allowed_env": ["ACSA_MODE"],
  "allowed_hosts": ["api.example.com"],
  "entry": "main.py",
  "inputs": ["payload"],
  "name": "Report Summary",
  "outputs": ["summary"],
  "runtime": "process",
  "type": "report-summary",
  "version": "1.0.0"
}"#,
        )
        .expect("manifest should be written");
        std::fs::write(&readme_path, "# Report Summary\n").expect("readme should be written");
        std::fs::write(&sample_input_path, "{}").expect("sample input should be written");

        let connector = crate::connectors::DiscoveredConnector {
            connector_dir: std::fs::canonicalize(&connector_dir)
                .expect("connector dir should canonicalize"),
            manifest: crate::connectors::ConnectorManifest {
                allowed_env: vec!["ACSA_MODE".to_string()],
                allowed_hosts: vec!["api.example.com".to_string()],
                allowed_paths: Default::default(),
                entry: "main.py".to_string(),
                enable_wasi: false,
                inputs: vec!["payload".to_string()],
                limits: Default::default(),
                name: "Report Summary".to_string(),
                outputs: vec!["summary".to_string()],
                runtime: crate::connectors::ConnectorRuntime::Process,
                type_id: "report-summary".to_string(),
                version: Some("1.0.0".to_string()),
            },
            manifest_path: std::fs::canonicalize(&manifest_path)
                .expect("manifest should canonicalize"),
        };

        let view = connector_view(&connector, &HashMap::new(), &HashMap::new());
        let payload = serde_json::to_value(view).expect("connector view should serialize");

        assert_eq!(payload["connector_state"]["install_validity"]["valid"], json!(true));
        assert_eq!(payload["connector_state"]["install_validity"]["state"], json!("valid"));
        assert_eq!(
            payload["connector_state"]["install_validity"]["manifest_path"],
            json!(std::fs::canonicalize(&manifest_path)
                .expect("manifest should canonicalize")
                .display()
                .to_string())
        );
        assert_eq!(payload["connector_state"]["runtime"]["mode"], json!("process"));
        assert_eq!(payload["connector_state"]["runtime"]["ready"], json!(true));
        assert_eq!(payload["connector_state"]["setup"]["required_setup"], json!([]));
        assert_eq!(payload["connector_state"]["trust"], json!("trusted"));

        let wasm_trusted = connector_state_from_facts(ConnectorStateFacts {
            install_validity: ConnectorInstallValidityState {
                connector_dir: "connectors/report-summary".to_string(),
                manifest_path: Some("connectors/report-summary/manifest.json".to_string()),
                reason: None,
                valid: true,
                state: ConnectorValidityState::Valid,
            },
            runtime_mode: Some(ConnectorRuntimeMode::Wasm),
            runtime_ready: true,
            required_setup: Vec::new(),
        });
        let wasm_trusted_payload =
            serde_json::to_value(wasm_trusted).expect("connector state should serialize");
        assert_eq!(wasm_trusted_payload["trust"], json!("trusted"));

        let invalid_view = invalid_connector_view(
            &crate::connectors::InvalidConnector {
                connector_dir: std::fs::canonicalize(&connector_dir)
                    .expect("connector dir should canonicalize"),
                error: "manifest failed validation".to_string(),
                attempted_type_id: None,
                manifest_path: Some(manifest_path.clone()),
            },
            &HashMap::new(),
            &HashMap::new(),
        );
        let invalid_payload =
            serde_json::to_value(invalid_view).expect("invalid connector view should serialize");
        assert_eq!(
            invalid_payload["connector_state"]["install_validity"]["state"],
            json!("invalid")
        );
        assert_eq!(invalid_payload["connector_state"]["install_validity"]["valid"], json!(false));
        assert_eq!(
            invalid_payload["connector_state"]["install_validity"]["reason"],
            json!("manifest failed validation")
        );
        assert_eq!(invalid_payload["connector_state"]["setup"]["required_setup"], json!([]));
        assert_eq!(invalid_payload["connector_state"]["trust"], json!("setup_required"));

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn run_provenance_marks_exact_snapshot_vs_fallback() {
        let exact = run_view(RunRecord {
            id: "run-exact".to_string(),
            workflow_name: "customer-intake".to_string(),
            status: "running".to_string(),
            started_at: 10,
            finished_at: None,
            error_message: None,
            workflow_revision: Some("sha256:exact".to_string()),
            editor_snapshot: Some("exact editor snapshot".to_string()),
            workflow_snapshot: None,
            initial_payload: None,
            state_json: None,
        });
        let exact_payload = serde_json::to_value(exact).expect("run view should serialize");
        assert_eq!(exact_payload["run_provenance"]["mode"], json!("exact"));
        assert_eq!(exact_payload["workflow_revision"], json!("sha256:exact"));

        let fallback = run_view(RunRecord {
            id: "run-fallback".to_string(),
            workflow_name: "customer-intake".to_string(),
            status: "running".to_string(),
            started_at: 20,
            finished_at: None,
            error_message: None,
            workflow_revision: Some("sha256:fallback".to_string()),
            editor_snapshot: None,
            workflow_snapshot: Some("saved workflow snapshot".to_string()),
            initial_payload: None,
            state_json: None,
        });
        let fallback_payload = serde_json::to_value(fallback).expect("run view should serialize");
        assert_eq!(fallback_payload["run_provenance"]["mode"], json!("fallback"));
        assert_eq!(fallback_payload["workflow_revision"], json!("sha256:fallback"));
    }

    #[test]
    fn run_detail_exposes_provenance_metadata() {
        let run = RunRecord {
            id: "run-fallback".to_string(),
            workflow_name: "customer-intake".to_string(),
            status: "success".to_string(),
            started_at: 20,
            finished_at: Some(24),
            error_message: None,
            workflow_revision: Some("sha256:fallback".to_string()),
            editor_snapshot: None,
            workflow_snapshot: Some(
                r#"
version: v1
name: customer intake
trigger:
  type: manual
steps: []
"#
                .to_string(),
            ),
            initial_payload: None,
            state_json: None,
        };

        let payload = serde_json::to_value(RunDetailResponse {
            editor_snapshot: run.editor_snapshot.clone(),
            human_tasks: Vec::new(),
            run: run_view(run.clone()),
            step_runs: Vec::new(),
            workflow_snapshot: run.workflow_snapshot.clone(),
        })
        .expect("run detail should serialize");

        assert_eq!(payload["run"]["workflow_revision"], json!("sha256:fallback"));
        assert_eq!(payload["run"]["run_provenance"]["mode"], json!("fallback"));
        assert_eq!(
            payload["run"]["run_provenance"]["message"],
            json!("Rendered from executed YAML snapshot.")
        );
        assert_eq!(
            payload["run"]["run_provenance"]["fallback_message"],
            json!("Historical editor layout is unavailable for this run.")
        );
    }

    #[test]
    fn run_list_exposes_provenance_metadata() {
        let exact = run_view(RunRecord {
            id: "run-exact".to_string(),
            workflow_name: "customer-intake".to_string(),
            status: "success".to_string(),
            started_at: 10,
            finished_at: Some(14),
            error_message: None,
            workflow_revision: Some("sha256:exact".to_string()),
            editor_snapshot: Some("ui:\n  positions: {}\n".to_string()),
            workflow_snapshot: Some(
                "version: v1\nname: customer intake\ntrigger:\n  type: manual\nsteps: []\n"
                    .to_string(),
            ),
            initial_payload: None,
            state_json: None,
        });
        let fallback = run_view(RunRecord {
            id: "run-fallback".to_string(),
            workflow_name: "customer-intake".to_string(),
            status: "failed".to_string(),
            started_at: 20,
            finished_at: Some(24),
            error_message: Some("boom".to_string()),
            workflow_revision: Some("sha256:fallback".to_string()),
            editor_snapshot: None,
            workflow_snapshot: Some(
                "version: v1\nname: customer intake\ntrigger:\n  type: manual\nsteps: []\n"
                    .to_string(),
            ),
            initial_payload: None,
            state_json: None,
        });

        let payload = serde_json::to_value(RunPageResponse {
            page: 1,
            page_size: 2,
            runs: vec![exact, fallback],
            total: 2,
        })
        .expect("run page should serialize");

        assert_eq!(payload["runs"][0]["run_provenance"]["mode"], json!("exact"));
        assert_eq!(
            payload["runs"][0]["run_provenance"]["fallback_message"],
            serde_json::Value::Null
        );
        assert_eq!(payload["runs"][1]["workflow_revision"], json!("sha256:fallback"));
        assert_eq!(payload["runs"][1]["run_provenance"]["mode"], json!("fallback"));
        assert_eq!(
            payload["runs"][1]["run_provenance"]["fallback_message"],
            json!("Historical editor layout is unavailable for this run.")
        );
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
        let connectors_dir = temp_dir.join("connectors");
        std::fs::create_dir_all(&connectors_dir).expect("connectors dir should be created");
        let db_path = temp_dir.join("runs.sqlite");

        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let response = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            create_workflow_document(
                &store,
                &connectors_dir,
                &temp_dir,
                CreateWorkflowRequest {
                    id: Some("draft".to_string()),
                    yaml: r#"
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
"#
                    .to_string(),
                },
            )
            .await
            .expect("workflow should be created");
            rename_workflow_document(
                &store,
                &connectors_dir,
                &temp_dir,
                "draft",
                RenameWorkflowRequest {
                    name: "Customer intake".to_string(),
                    target_id: "customer-intake".to_string(),
                    yaml: None,
                },
            )
            .await
            .expect("rename should succeed")
        });

        assert_eq!(response.id, "customer-intake");
        assert_eq!(response.summary.file_name, "customer-intake.yaml");
        assert_eq!(response.summary.name, "Customer intake");
        let renamed_yaml = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should reconnect");
            store.get_workflow("customer-intake").await.expect("renamed workflow should exist").yaml
        });
        assert!(renamed_yaml.contains("name: Customer intake"));

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn rename_uses_supplied_yaml_when_present() {
        let temp_dir = write_temp_directory("rename-yaml");
        let connectors_dir = temp_dir.join("connectors");
        std::fs::create_dir_all(&connectors_dir).expect("connectors dir should be created");
        let db_path = temp_dir.join("runs.sqlite");

        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let response = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            create_workflow_document(
                &store,
                &connectors_dir,
                &temp_dir,
                CreateWorkflowRequest {
                    id: Some("draft".to_string()),
                    yaml: r#"
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
"#
                    .to_string(),
                },
            )
            .await
            .expect("workflow should be created");
            rename_workflow_document(
                &store,
                &connectors_dir,
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
            .await
            .expect("rename should succeed")
        });

        assert_eq!(response.summary.name, "Updated draft");
        assert!(response.yaml.contains("value: 99"));

        std::fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn rename_id_only_preserves_summary_telemetry() {
        let temp_dir = write_temp_directory("rename-id-only");
        let connectors_dir = temp_dir.join("connectors");
        let workflows_dir = temp_dir.join("workflows");
        std::fs::create_dir_all(&connectors_dir).expect("connectors dir should be created");
        std::fs::create_dir_all(&workflows_dir).expect("workflows dir should be created");
        let db_path = temp_dir.join("runs.sqlite");
        std::fs::write(
            workflows_dir.join("draft.yaml"),
            r#"
version: v1
name: customer intake
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

        let runtime = tokio::runtime::Runtime::new().expect("runtime should create");
        let response = runtime.block_on(async {
            let store = RunStore::connect(&db_path).await.expect("store should connect");
            seed_workflows_from_directory_if_missing(&store, &workflows_dir)
                .await
                .expect("workflows should seed");
            let run = store
                .start_run(
                    "customer intake",
                    "sha256:exact-workflow",
                    "exact workflow snapshot",
                    Some("exact editor snapshot"),
                    &serde_json::json!({"value": true}),
                )
                .await
                .expect("run should start");
            store.complete_run_success(&run.id).await.expect("run should complete");

            rename_workflow_document(
                &store,
                &connectors_dir,
                &workflows_dir,
                "draft",
                RenameWorkflowRequest {
                    name: "customer intake".to_string(),
                    target_id: "customer-intake".to_string(),
                    yaml: None,
                },
            )
            .await
            .expect("rename should succeed")
        });

        let payload = serde_json::to_value(response).expect("response should serialize");
        assert_eq!(
            payload["summary"]["workflow_state"]["telemetry"]["last_run_status"],
            json!("success")
        );
        assert_ne!(
            payload["summary"]["workflow_state"]["telemetry"]["last_run_at"],
            serde_json::Value::Null
        );

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
