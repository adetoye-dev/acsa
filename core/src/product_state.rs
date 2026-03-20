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

use std::collections::{BTreeSet, HashMap};

use serde::Serialize;

use crate::{
    connectors::{
        wasm_connectors_enabled, ConnectorRuntime, DiscoveredConnector, InvalidConnector,
    },
    models::Workflow,
    storage::RunRecord,
};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowLifecycleState {
    Draft,
    Saved,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowValidationState {
    Valid,
    Invalid,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowReadinessState {
    Ready,
    BlockedByValidation,
    BlockedByConnector,
    BlockedBySetup,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WorkflowConnectorRequirementsState {
    pub required_step_types: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WorkflowTelemetryFacts {
    pub last_run_at: i64,
    pub last_run_status: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WorkflowFacts {
    pub connector_requirements: WorkflowConnectorRequirementsState,
    pub connector_requirements_unmet: bool,
    pub connector_runtime_blocked: bool,
    pub connector_setup_blocked: bool,
    pub latest_run: Option<WorkflowTelemetryFacts>,
    pub lifecycle: WorkflowLifecycleState,
    pub validation_state: WorkflowValidationState,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WorkflowReadiness {
    pub connector_requirements: WorkflowConnectorRequirementsState,
    pub readiness_state: WorkflowReadinessState,
    pub validation_state: WorkflowValidationState,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WorkflowTelemetry {
    pub last_run_at: Option<i64>,
    pub last_run_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WorkflowState {
    pub lifecycle: WorkflowLifecycleState,
    pub readiness: WorkflowReadiness,
    pub telemetry: WorkflowTelemetry,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorValidityState {
    Valid,
    Invalid,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorRuntimeMode {
    Process,
    Wasm,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorTrustState {
    Trusted,
    SetupRequired,
    RuntimeRestricted,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ConnectorInstallValidityState {
    pub connector_dir: String,
    pub manifest_path: Option<String>,
    pub reason: Option<String>,
    pub valid: bool,
    pub state: ConnectorValidityState,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ConnectorRuntimeState {
    pub mode: Option<ConnectorRuntimeMode>,
    pub ready: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ConnectorSetupState {
    pub required_setup: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ConnectorStateFacts {
    pub install_validity: ConnectorInstallValidityState,
    pub required_setup: Vec<String>,
    pub runtime_mode: Option<ConnectorRuntimeMode>,
    pub runtime_ready: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ConnectorState {
    pub install_validity: ConnectorInstallValidityState,
    pub runtime: ConnectorRuntimeState,
    pub setup: ConnectorSetupState,
    pub trust: ConnectorTrustState,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunProvenanceMode {
    Exact,
    Fallback,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RunProvenance {
    pub fallback_message: Option<String>,
    pub message: String,
    pub mode: RunProvenanceMode,
}

pub fn workflow_connector_requirements(workflow: &Workflow) -> WorkflowConnectorRequirementsState {
    let mut required_step_types = BTreeSet::new();
    for step in &workflow.steps {
        if !is_builtin_step_type(step.r#type.as_str()) {
            required_step_types.insert(step.r#type.clone());
        }
    }

    WorkflowConnectorRequirementsState {
        required_step_types: required_step_types.into_iter().collect(),
    }
}

pub fn workflow_state_from_facts(facts: WorkflowFacts) -> WorkflowState {
    let readiness_state = workflow_readiness_state(
        facts.validation_state,
        facts.connector_requirements_unmet,
        facts.connector_runtime_blocked,
        facts.connector_setup_blocked,
    );

    WorkflowState {
        lifecycle: facts.lifecycle,
        readiness: WorkflowReadiness {
            connector_requirements: facts.connector_requirements,
            readiness_state,
            validation_state: facts.validation_state,
        },
        telemetry: workflow_telemetry_from_facts(facts.latest_run.as_ref()),
    }
}

pub fn workflow_telemetry_from_facts(facts: Option<&WorkflowTelemetryFacts>) -> WorkflowTelemetry {
    WorkflowTelemetry {
        last_run_at: facts.map(|fact| fact.last_run_at),
        last_run_status: facts.map(|fact| fact.last_run_status.clone()),
    }
}

pub fn latest_workflow_telemetry(
    runs: impl IntoIterator<Item = RunRecord>,
) -> HashMap<String, WorkflowTelemetryFacts> {
    let mut latest = HashMap::<String, (RunTelemetryRank, WorkflowTelemetryFacts)>::new();

    for run in runs {
        let rank = run_telemetry_rank(&run);
        let telemetry = WorkflowTelemetryFacts {
            last_run_at: run.finished_at.unwrap_or(run.started_at),
            last_run_status: run.status,
        };

        match latest.get(&run.workflow_name) {
            Some((existing_rank, _)) if *existing_rank >= rank => {}
            _ => {
                latest.insert(run.workflow_name, (rank, telemetry));
            }
        }
    }

    latest.into_iter().map(|(workflow_name, (_, telemetry))| (workflow_name, telemetry)).collect()
}

pub fn workflow_readiness_state(
    validation_state: WorkflowValidationState,
    connector_requirements_unmet: bool,
    connector_runtime_blocked: bool,
    connector_setup_blocked: bool,
) -> WorkflowReadinessState {
    match validation_state {
        WorkflowValidationState::Invalid => WorkflowReadinessState::BlockedByValidation,
        WorkflowValidationState::Valid if connector_requirements_unmet => {
            WorkflowReadinessState::BlockedByConnector
        }
        WorkflowValidationState::Valid if connector_runtime_blocked || connector_setup_blocked => {
            WorkflowReadinessState::BlockedBySetup
        }
        WorkflowValidationState::Valid => WorkflowReadinessState::Ready,
    }
}

pub fn connector_state_from_facts(facts: ConnectorStateFacts) -> ConnectorState {
    ConnectorState {
        install_validity: facts.install_validity.clone(),
        runtime: ConnectorRuntimeState { mode: facts.runtime_mode, ready: facts.runtime_ready },
        setup: ConnectorSetupState { required_setup: facts.required_setup.clone() },
        trust: connector_trust_from_facts(&facts),
    }
}

pub fn connector_state(connector: &DiscoveredConnector) -> ConnectorState {
    let runtime_mode = connector_runtime_mode(connector.manifest.runtime);
    let runtime_ready =
        connector.manifest.runtime != ConnectorRuntime::Wasm || wasm_connectors_enabled();
    let required_setup = if connector.manifest.runtime == ConnectorRuntime::Wasm && !runtime_ready {
        vec!["enable ACSA_ENABLE_WASM_CONNECTORS=1".to_string()]
    } else {
        Vec::new()
    };

    connector_state_from_facts(ConnectorStateFacts {
        install_validity: ConnectorInstallValidityState {
            connector_dir: connector.connector_dir.display().to_string(),
            manifest_path: Some(connector.manifest_path.display().to_string()),
            reason: None,
            valid: true,
            state: ConnectorValidityState::Valid,
        },
        required_setup,
        runtime_mode: Some(runtime_mode),
        runtime_ready,
    })
}

pub fn invalid_connector_state(connector: &InvalidConnector) -> ConnectorState {
    connector_state_from_facts(ConnectorStateFacts {
        install_validity: ConnectorInstallValidityState {
            connector_dir: connector.connector_dir.display().to_string(),
            manifest_path: connector.manifest_path.as_ref().map(|path| path.display().to_string()),
            reason: Some(connector.error.clone()),
            valid: false,
            state: ConnectorValidityState::Invalid,
        },
        required_setup: Vec::new(),
        runtime_mode: None,
        runtime_ready: false,
    })
}

pub fn run_provenance(run: &RunRecord) -> RunProvenance {
    if run.editor_snapshot.is_some() {
        RunProvenance {
            fallback_message: None,
            message: "Rendered with historical editor snapshot.".to_string(),
            mode: RunProvenanceMode::Exact,
        }
    } else {
        RunProvenance {
            fallback_message: Some(
                "Historical editor layout is unavailable for this run.".to_string(),
            ),
            message: "Rendered from executed YAML snapshot.".to_string(),
            mode: RunProvenanceMode::Fallback,
        }
    }
}

fn connector_trust_from_facts(facts: &ConnectorStateFacts) -> ConnectorTrustState {
    if !facts.install_validity.valid {
        return ConnectorTrustState::SetupRequired;
    }

    if facts.runtime_ready {
        return ConnectorTrustState::Trusted;
    }

    if matches!(facts.runtime_mode, Some(ConnectorRuntimeMode::Wasm)) {
        ConnectorTrustState::RuntimeRestricted
    } else {
        match facts.required_setup.is_empty() {
            true => ConnectorTrustState::RuntimeRestricted,
            false => ConnectorTrustState::SetupRequired,
        }
    }
}

fn connector_runtime_mode(runtime: ConnectorRuntime) -> ConnectorRuntimeMode {
    match runtime {
        ConnectorRuntime::Process => ConnectorRuntimeMode::Process,
        ConnectorRuntime::Wasm => ConnectorRuntimeMode::Wasm,
    }
}

type RunTelemetryRank = (i64, i64, bool, bool, bool, String);

fn run_telemetry_rank(run: &RunRecord) -> RunTelemetryRank {
    (
        run.started_at,
        run.finished_at.unwrap_or(run.started_at),
        run.workflow_snapshot.is_some(),
        run.editor_snapshot.is_some(),
        run.state_json.is_some(),
        run.id.clone(),
    )
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
