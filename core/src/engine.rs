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
    collections::{HashMap, HashSet, VecDeque},
    fs,
    path::Path,
    sync::Arc,
    time::Duration,
};

use petgraph::{
    algo::toposort,
    graph::{DiGraph, NodeIndex},
    Direction,
};
use serde_json::{Map, Value};
use thiserror::Error;
use tokio::{sync::Semaphore, task::JoinSet, time::timeout};

use crate::{
    models::{Step, Trigger, Workflow},
    nodes::{split_control, BuiltInNodeConfig, NodeError, NodeOutcome, NodeRegistry},
    storage::{RunStore, StorageError},
};

const SUPPORTED_WORKFLOW_VERSION: &str = "v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExecutionConfig {
    pub default_timeout_ms: u64,
    pub max_concurrency: usize,
}

impl Default for ExecutionConfig {
    fn default() -> Self {
        Self { default_timeout_ms: 30_000, max_concurrency: 4 }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExecutionSummary {
    pub completed_steps: usize,
    pub outputs: HashMap<String, Value>,
    pub run_id: String,
    pub workflow_name: String,
}

#[derive(Clone)]
pub struct WorkflowEngine {
    config: ExecutionConfig,
    registry: NodeRegistry,
    store: RunStore,
}

impl WorkflowEngine {
    pub async fn new(
        database_path: impl AsRef<Path>,
        config: ExecutionConfig,
    ) -> Result<Self, EngineError> {
        let store = RunStore::connect(database_path).await?;
        Ok(Self { config, registry: NodeRegistry::built_in(BuiltInNodeConfig::default()), store })
    }

    pub fn with_registry(store: RunStore, registry: NodeRegistry, config: ExecutionConfig) -> Self {
        Self { config, registry, store }
    }

    pub fn store(&self) -> &RunStore {
        &self.store
    }

    pub async fn execute_workflow_path(
        &self,
        path: impl AsRef<Path>,
        initial_payload: Value,
    ) -> Result<ExecutionSummary, EngineError> {
        let workflow = load_workflow_from_path(path)?;
        let plan = compile_workflow(workflow)?;
        self.execute_plan(&plan, initial_payload).await
    }

    pub async fn execute_plan(
        &self,
        plan: &WorkflowPlan,
        initial_payload: Value,
    ) -> Result<ExecutionSummary, EngineError> {
        let run = self.store.start_run(&plan.workflow.name).await?;
        let semaphore = Arc::new(Semaphore::new(self.config.max_concurrency.max(1)));
        let mut remaining_dependencies = plan.remaining_dependencies();
        let mut activation_votes =
            plan.steps.keys().map(|step_id| (step_id.clone(), 0usize)).collect();
        let mut ready_steps = VecDeque::from(plan.root_steps());
        let mut outputs = HashMap::new();
        let mut join_set = JoinSet::new();
        let mut completed_steps = 0usize;
        let mut failure: Option<StepExecutionFailure> = None;

        while !ready_steps.is_empty() || !join_set.is_empty() {
            while failure.is_none() {
                let Some(step_id) = ready_steps.pop_front() else {
                    break;
                };
                let step = plan.step(&step_id).cloned().ok_or_else(|| {
                    EngineError::MissingStepDefinition { step_id: step_id.clone() }
                })?;
                let inputs = build_step_inputs(plan, &step_id, &outputs, &initial_payload)?;
                let permit = semaphore
                    .clone()
                    .acquire_owned()
                    .await
                    .map_err(|_| EngineError::ConcurrencyUnavailable)?;
                let registry = self.registry.clone();
                let store = self.store.clone();
                let run_id = run.id.clone();
                let timeout_ms = step.timeout_ms.unwrap_or(self.config.default_timeout_ms);

                join_set.spawn(async move {
                    let _permit = permit;
                    execute_step_with_retries(&store, &registry, &run_id, &step, inputs, timeout_ms)
                        .await
                });
            }

            let Some(joined) = join_set.join_next().await else {
                break;
            };

            match joined {
                Ok(Ok(step_success)) => {
                    completed_steps += 1;
                    let selected_successors = resolve_selected_successors(
                        plan,
                        &step_success.step_id,
                        &step_success.outcome,
                    )?;
                    outputs
                        .insert(step_success.step_id.clone(), step_success.outcome.payload.clone());
                    let mut scheduler = SchedulerState {
                        activation_votes: &mut activation_votes,
                        initial_payload: &initial_payload,
                        outputs: &mut outputs,
                        plan,
                        ready_steps: &mut ready_steps,
                        remaining_dependencies: &mut remaining_dependencies,
                        run_id: &run.id,
                        store: &self.store,
                    };
                    scheduler
                        .advance_successors(&step_success.step_id, &selected_successors)
                        .await?;
                }
                Ok(Err(step_failure)) => {
                    failure = Some(step_failure);
                    join_set.abort_all();
                    while join_set.join_next().await.is_some() {}
                }
                Err(source) => {
                    let message = format!("step task failed to join: {source}");
                    self.store.complete_run_failure(&run.id, &message).await?;
                    return Err(EngineError::StepJoin { source });
                }
            }
        }

        if let Some(step_failure) = failure {
            self.store.complete_run_failure(&run.id, &step_failure.error).await?;
            return Err(EngineError::WorkflowRunFailed {
                error: step_failure.error,
                run_id: run.id,
                step_id: step_failure.step_id,
            });
        }

        self.store.complete_run_success(&run.id).await?;
        Ok(ExecutionSummary {
            completed_steps,
            outputs,
            run_id: run.id,
            workflow_name: plan.workflow.name.clone(),
        })
    }
}

#[derive(Debug, Clone)]
pub struct WorkflowPlan {
    order: Vec<String>,
    predecessors: HashMap<String, Vec<String>>,
    steps: HashMap<String, Step>,
    successors: HashMap<String, Vec<String>>,
    pub workflow: Workflow,
}

impl WorkflowPlan {
    pub fn order(&self) -> &[String] {
        &self.order
    }

    pub fn root_steps(&self) -> Vec<String> {
        self.steps
            .keys()
            .filter(|step_id| self.predecessors.get(*step_id).is_none_or(Vec::is_empty))
            .cloned()
            .collect()
    }

    pub fn remaining_dependencies(&self) -> HashMap<String, usize> {
        self.steps
            .keys()
            .map(|step_id| (step_id.clone(), self.predecessors.get(step_id).map_or(0, Vec::len)))
            .collect()
    }

    pub fn predecessors(&self, step_id: &str) -> &[String] {
        self.predecessors.get(step_id).map_or(&[], Vec::as_slice)
    }

    pub fn step(&self, step_id: &str) -> Option<&Step> {
        self.steps.get(step_id)
    }

    pub fn successors(&self, step_id: &str) -> &[String] {
        self.successors.get(step_id).map_or(&[], Vec::as_slice)
    }
}

pub fn compile_workflow(workflow: Workflow) -> Result<WorkflowPlan, EngineError> {
    validate_workflow(&workflow)?;

    let mut graph = DiGraph::<String, ()>::new();
    let mut node_indices = HashMap::new();
    let mut steps = HashMap::new();

    for step in workflow.steps.iter().cloned() {
        let step_id = step.id.clone();
        let node_index = graph.add_node(step_id.clone());
        node_indices.insert(step_id.clone(), node_index);
        steps.insert(step_id, step);
    }

    for step in &workflow.steps {
        let source = node_indices
            .get(&step.id)
            .copied()
            .ok_or_else(|| EngineError::MissingStepDefinition { step_id: step.id.clone() })?;
        for next_step in &step.next {
            let target = node_indices.get(next_step).copied().ok_or_else(|| {
                EngineError::UnknownNextStep {
                    next_step: next_step.clone(),
                    step_id: step.id.clone(),
                }
            })?;
            graph.add_edge(source, target, ());
        }
    }

    let order = toposort(&graph, None)
        .map_err(|cycle| EngineError::GraphCycleDetected {
            step_id: graph
                .node_weight(cycle.node_id())
                .cloned()
                .unwrap_or_else(|| "<unknown>".to_string()),
        })?
        .into_iter()
        .map(|node_index| {
            graph.node_weight(node_index).cloned().expect("node index from toposort should exist")
        })
        .collect();

    let predecessors = build_neighbour_map(&graph, &node_indices, Direction::Incoming);
    let successors = build_neighbour_map(&graph, &node_indices, Direction::Outgoing);

    Ok(WorkflowPlan { order, predecessors, steps, successors, workflow })
}

pub fn load_workflow_from_path(path: impl AsRef<Path>) -> Result<Workflow, EngineError> {
    let path = path.as_ref();
    let path_display = path.display().to_string();
    let raw = fs::read_to_string(path)
        .map_err(|source| EngineError::ReadWorkflow { path: path_display.clone(), source })?;

    let workflow = serde_yaml::from_str::<Workflow>(&raw)
        .map_err(|source| EngineError::ParseWorkflow { path: path_display, source })?;

    validate_workflow(&workflow)?;

    Ok(workflow)
}

pub fn load_workflows_from_dir(path: impl AsRef<Path>) -> Result<Vec<Workflow>, EngineError> {
    let path = path.as_ref();
    let mut workflow_paths = Vec::new();
    for entry in fs::read_dir(path).map_err(|source| EngineError::ReadWorkflowDirectory {
        path: path.display().to_string(),
        source,
    })? {
        let entry = entry.map_err(|source| EngineError::ReadWorkflowDirectory {
            path: path.display().to_string(),
            source,
        })?;
        let entry_path = entry.path();
        if matches!(
            entry_path.extension().and_then(|extension| extension.to_str()),
            Some("yaml" | "yml")
        ) {
            workflow_paths.push(entry_path);
        }
    }

    workflow_paths.sort();
    workflow_paths.into_iter().map(load_workflow_from_path).collect()
}

pub fn validate_workflow(workflow: &Workflow) -> Result<(), EngineError> {
    if workflow.version.trim() != SUPPORTED_WORKFLOW_VERSION {
        return Err(EngineError::UnsupportedWorkflowVersion { version: workflow.version.clone() });
    }

    if workflow.name.trim().is_empty() {
        return Err(EngineError::EmptyWorkflowName);
    }

    if workflow.trigger.r#type.trim().is_empty() {
        return Err(EngineError::EmptyTriggerType);
    }

    validate_trigger(&workflow.trigger)?;

    if workflow.steps.is_empty() {
        return Err(EngineError::WorkflowHasNoSteps);
    }

    let mut step_ids = HashSet::new();

    for step in &workflow.steps {
        if step.id.trim().is_empty() {
            return Err(EngineError::EmptyStepId);
        }

        if step.r#type.trim().is_empty() {
            return Err(EngineError::EmptyStepType { step_id: step.id.clone() });
        }

        if !step_ids.insert(step.id.clone()) {
            return Err(EngineError::DuplicateStepId { step_id: step.id.clone() });
        }

        if let Some(retry) = &step.retry {
            if retry.attempts == 0 {
                return Err(EngineError::InvalidRetryAttempts { step_id: step.id.clone() });
            }
        }
    }

    for step in &workflow.steps {
        for next_step in &step.next {
            if !step_ids.contains(next_step) {
                return Err(EngineError::UnknownNextStep {
                    step_id: step.id.clone(),
                    next_step: next_step.clone(),
                });
            }
        }
    }

    Ok(())
}

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("failed to read workflow file {path}: {source}")]
    ReadWorkflow {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to parse workflow file {path}: {source}")]
    ParseWorkflow {
        path: String,
        #[source]
        source: serde_yaml::Error,
    },
    #[error("failed to read workflow directory {path}: {source}")]
    ReadWorkflowDirectory {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("unsupported workflow version {version}; expected v1")]
    UnsupportedWorkflowVersion { version: String },
    #[error("workflow name must not be empty")]
    EmptyWorkflowName,
    #[error("workflow trigger type must not be empty")]
    EmptyTriggerType,
    #[error("unsupported workflow trigger type {trigger_type}")]
    UnsupportedTriggerType { trigger_type: String },
    #[error("trigger {trigger_type} is missing required field {detail}")]
    MissingTriggerDetail { detail: &'static str, trigger_type: &'static str },
    #[error("trigger {trigger_type} has invalid field {detail}: {message}")]
    InvalidTriggerDetail { detail: String, message: String, trigger_type: String },
    #[error("cron schedule {schedule} is invalid: {message}")]
    InvalidCronSchedule { schedule: String, message: String },
    #[error("step {step_id} selected non-adjacent control target {target}")]
    InvalidControlTarget { step_id: String, target: String },
    #[error("workflow must contain at least one step")]
    WorkflowHasNoSteps,
    #[error("workflow contains a step with an empty id")]
    EmptyStepId,
    #[error("step {step_id} must declare a non-empty type")]
    EmptyStepType { step_id: String },
    #[error("duplicate step id detected: {step_id}")]
    DuplicateStepId { step_id: String },
    #[error("step {step_id} declares retry attempts as 0")]
    InvalidRetryAttempts { step_id: String },
    #[error("step {step_id} points to unknown downstream step {next_step}")]
    UnknownNextStep { step_id: String, next_step: String },
    #[error("workflow graph contains a cycle near step {step_id}")]
    GraphCycleDetected { step_id: String },
    #[error("workflow planning could not find step definition {step_id}")]
    MissingStepDefinition { step_id: String },
    #[error("step execution could not acquire a concurrency permit")]
    ConcurrencyUnavailable,
    #[error("step task failed to join: {source}")]
    StepJoin {
        #[source]
        source: tokio::task::JoinError,
    },
    #[error("step {step_id} is missing upstream output from {upstream_step}")]
    MissingUpstreamOutput { step_id: String, upstream_step: String },
    #[error("workflow run {run_id} failed in step {step_id}: {error}")]
    WorkflowRunFailed { error: String, run_id: String, step_id: String },
    #[error("workflow engine storage error: {0}")]
    Storage(#[from] StorageError),
    #[error("failed to convert yaml step parameters to json: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug)]
struct StepExecutionFailure {
    error: String,
    step_id: String,
}

#[derive(Debug)]
struct StepExecutionSuccess {
    outcome: NodeOutcome,
    step_id: String,
}

fn backoff_for_attempt(base_backoff_ms: u64, attempt: u32) -> u64 {
    if base_backoff_ms == 0 {
        return 0;
    }
    let multiplier = 2_u64.saturating_pow(attempt.saturating_sub(1));
    base_backoff_ms.saturating_mul(multiplier)
}

fn build_neighbour_map(
    graph: &DiGraph<String, ()>,
    node_indices: &HashMap<String, NodeIndex>,
    direction: Direction,
) -> HashMap<String, Vec<String>> {
    node_indices
        .iter()
        .map(|(step_id, node_index)| {
            let neighbours = graph
                .neighbors_directed(*node_index, direction)
                .map(|neighbour| {
                    graph.node_weight(neighbour).cloned().expect("neighbour node should exist")
                })
                .collect();
            (step_id.clone(), neighbours)
        })
        .collect()
}

struct SchedulerState<'a> {
    activation_votes: &'a mut HashMap<String, usize>,
    initial_payload: &'a Value,
    outputs: &'a mut HashMap<String, Value>,
    plan: &'a WorkflowPlan,
    ready_steps: &'a mut VecDeque<String>,
    remaining_dependencies: &'a mut HashMap<String, usize>,
    run_id: &'a str,
    store: &'a RunStore,
}

impl SchedulerState<'_> {
    async fn advance_successors(
        &mut self,
        step_id: &str,
        selected_successors: &HashSet<String>,
    ) -> Result<(), EngineError> {
        for successor in self.plan.successors(step_id) {
            if let Some(remaining) = self.remaining_dependencies.get_mut(successor) {
                *remaining = remaining.saturating_sub(1);
            }
            if selected_successors.contains(successor) {
                *self.activation_votes.entry(successor.clone()).or_default() += 1;
            }
        }

        let mut skipped_roots = Vec::new();
        for successor in self.plan.successors(step_id) {
            if self.remaining_dependencies.get(successor).copied().unwrap_or_default() == 0 {
                if self.activation_votes.get(successor).copied().unwrap_or_default() > 0 {
                    self.ready_steps.push_back(successor.clone());
                } else {
                    skipped_roots.push(successor.clone());
                }
            }
        }

        self.mark_skipped_steps(skipped_roots).await
    }

    async fn mark_skipped_steps(&mut self, skipped_roots: Vec<String>) -> Result<(), EngineError> {
        let mut queue = VecDeque::from(skipped_roots);

        while let Some(step_id) = queue.pop_front() {
            if self.outputs.contains_key(&step_id) {
                continue;
            }

            let inputs =
                build_step_inputs(self.plan, &step_id, self.outputs, self.initial_payload)?;
            self.store.record_step_skipped(self.run_id, &step_id, &inputs).await?;
            self.outputs.insert(step_id.clone(), Value::Null);

            for successor in self.plan.successors(&step_id) {
                if let Some(remaining) = self.remaining_dependencies.get_mut(successor) {
                    *remaining = remaining.saturating_sub(1);
                }
            }

            for successor in self.plan.successors(&step_id) {
                if self.remaining_dependencies.get(successor).copied().unwrap_or_default() != 0 {
                    continue;
                }

                if self.activation_votes.get(successor).copied().unwrap_or_default() > 0 {
                    self.ready_steps.push_back(successor.clone());
                } else {
                    queue.push_back(successor.clone());
                }
            }
        }

        Ok(())
    }
}

fn build_step_inputs(
    plan: &WorkflowPlan,
    step_id: &str,
    outputs: &HashMap<String, Value>,
    initial_payload: &Value,
) -> Result<Value, EngineError> {
    let predecessors = plan.predecessors(step_id);
    if predecessors.is_empty() {
        return Ok(initial_payload.clone());
    }

    let mut payload = Map::new();
    for predecessor in predecessors {
        let output =
            outputs.get(predecessor).ok_or_else(|| EngineError::MissingUpstreamOutput {
                step_id: step_id.to_string(),
                upstream_step: predecessor.clone(),
            })?;
        payload.insert(predecessor.clone(), output.clone());
    }

    Ok(Value::Object(payload))
}

async fn execute_step_with_retries(
    store: &RunStore,
    registry: &NodeRegistry,
    run_id: &str,
    step: &Step,
    inputs: Value,
    timeout_ms: u64,
) -> Result<StepExecutionSuccess, StepExecutionFailure> {
    let params = serde_json::to_value(&step.params).map_err(|error| StepExecutionFailure {
        step_id: step.id.clone(),
        error: format!("failed to convert params to json: {error}"),
    })?;
    let attempts = step.retry.as_ref().map(|retry| retry.attempts).unwrap_or(1).max(1);
    let backoff_ms = step.retry.as_ref().map(|retry| retry.backoff_ms).unwrap_or(0);

    let node = registry.get(&step.r#type).ok_or_else(|| StepExecutionFailure {
        step_id: step.id.clone(),
        error: format!("unknown node type {}", step.r#type),
    })?;

    for attempt in 1..=attempts {
        let step_run = store.start_step_attempt(run_id, &step.id, attempt, &inputs).await.map_err(
            |error| StepExecutionFailure { step_id: step.id.clone(), error: error.to_string() },
        )?;

        let outcome =
            timeout(Duration::from_millis(timeout_ms), node.execute(&inputs, &params)).await;
        match outcome {
            Ok(Ok(output)) => {
                let outcome = split_control(output).map_err(|error| StepExecutionFailure {
                    step_id: step.id.clone(),
                    error: error_message(&error),
                })?;
                let stored_output = persisted_outcome(&outcome);
                store.complete_step_success(&step_run.id, &stored_output).await.map_err(
                    |error| StepExecutionFailure {
                        step_id: step.id.clone(),
                        error: error.to_string(),
                    },
                )?;
                return Ok(StepExecutionSuccess { outcome, step_id: step.id.clone() });
            }
            Ok(Err(error)) => {
                let message = error_message(&error);
                store.complete_step_failure(&step_run.id, &message).await.map_err(
                    |storage_error| StepExecutionFailure {
                        step_id: step.id.clone(),
                        error: storage_error.to_string(),
                    },
                )?;

                if attempt == attempts {
                    return Err(StepExecutionFailure { step_id: step.id.clone(), error: message });
                }
            }
            Err(_) => {
                let message = format!("step timed out after {timeout_ms}ms");
                store.complete_step_failure(&step_run.id, &message).await.map_err(
                    |storage_error| StepExecutionFailure {
                        step_id: step.id.clone(),
                        error: storage_error.to_string(),
                    },
                )?;

                if attempt == attempts {
                    return Err(StepExecutionFailure { step_id: step.id.clone(), error: message });
                }
            }
        }

        let sleep_ms = backoff_for_attempt(backoff_ms, attempt);
        if sleep_ms > 0 {
            tokio::time::sleep(Duration::from_millis(sleep_ms)).await;
        }
    }

    Err(StepExecutionFailure {
        step_id: step.id.clone(),
        error: "step retry loop ended unexpectedly".to_string(),
    })
}

fn error_message(error: &NodeError) -> String {
    match error {
        NodeError::Message { message } => message.clone(),
        other => other.to_string(),
    }
}

fn persisted_outcome(outcome: &NodeOutcome) -> Value {
    if outcome.control.next.is_empty() {
        return outcome.payload.clone();
    }

    serde_json::json!({
        "payload": outcome.payload,
        "control": {
            "next": outcome.control.next
        }
    })
}

fn resolve_selected_successors(
    plan: &WorkflowPlan,
    step_id: &str,
    outcome: &NodeOutcome,
) -> Result<HashSet<String>, EngineError> {
    let direct_successors = plan.successors(step_id);
    if outcome.control.next.is_empty() {
        return Ok(direct_successors.iter().cloned().collect());
    }

    let direct_lookup = direct_successors.iter().map(String::as_str).collect::<HashSet<_>>();
    let mut selected = HashSet::with_capacity(outcome.control.next.len());
    for target in &outcome.control.next {
        if !direct_lookup.contains(target.as_str()) {
            return Err(EngineError::InvalidControlTarget {
                step_id: step_id.to_string(),
                target: target.clone(),
            });
        }
        selected.insert(target.clone());
    }

    Ok(selected)
}

fn validate_trigger(trigger: &Trigger) -> Result<(), EngineError> {
    match trigger.r#type.as_str() {
        "manual" => Ok(()),
        "cron" => {
            let schedule = trigger
                .details
                .get("schedule")
                .or_else(|| trigger.details.get("expression"))
                .ok_or(EngineError::MissingTriggerDetail {
                    detail: "schedule",
                    trigger_type: "cron",
                })?;
            let schedule = yaml_string(schedule, "schedule", "cron")?;
            schedule.parse::<cron::Schedule>().map_err(|error| {
                EngineError::InvalidCronSchedule {
                    schedule: schedule.to_string(),
                    message: error.to_string(),
                }
            })?;
            Ok(())
        }
        "webhook" => {
            let _ = trigger
                .details
                .get("secret_env")
                .or_else(|| trigger.details.get("token_env"))
                .ok_or(EngineError::MissingTriggerDetail {
                    detail: "secret_env",
                    trigger_type: "webhook",
                })?;
            if let Some(path) = trigger.details.get("path") {
                let path = yaml_string(path, "path", "webhook")?;
                if !path.starts_with('/') {
                    return Err(EngineError::InvalidTriggerDetail {
                        detail: "path".to_string(),
                        message: "webhook path must start with '/'".to_string(),
                        trigger_type: "webhook".to_string(),
                    });
                }
            }
            Ok(())
        }
        other => Err(EngineError::UnsupportedTriggerType { trigger_type: other.to_string() }),
    }
}

fn yaml_string<'a>(
    value: &'a serde_yaml::Value,
    detail: &str,
    trigger_type: &str,
) -> Result<&'a str, EngineError> {
    value.as_str().ok_or(EngineError::InvalidTriggerDetail {
        detail: detail.to_string(),
        message: "expected a string".to_string(),
        trigger_type: trigger_type.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
        time::{SystemTime, UNIX_EPOCH},
    };

    use async_trait::async_trait;
    use serde_json::{json, Value};

    use super::{
        compile_workflow, load_workflow_from_path, load_workflows_from_dir, validate_workflow,
        EngineError, ExecutionConfig, WorkflowEngine,
    };
    use crate::{
        models::{RetryPolicy, Step, Trigger, Workflow},
        nodes::{BuiltInNodeConfig, Node, NodeError, NodeRegistry},
        storage::RunStore,
    };

    #[test]
    fn loads_and_validates_a_workflow_file() {
        let path = write_temp_workflow(
            "validation.yaml",
            r#"
version: v1
name: foundation-check
trigger:
  type: manual
steps:
  - id: start
    type: constant
    params:
      value: ok
    next: []
"#,
        );

        let workflow = load_workflow_from_path(&path).expect("workflow should parse");

        assert_eq!(workflow.name, "foundation-check");
        assert_eq!(workflow.trigger.r#type, "manual");
        assert_eq!(workflow.steps.len(), 1);

        fs::remove_file(path).expect("temp file cleanup should succeed");
    }

    #[test]
    fn loads_multiple_workflows_from_a_directory() {
        let temp_dir = write_temp_directory("loader");
        let first = temp_dir.join("one.yaml");
        let second = temp_dir.join("two.yaml");
        fs::write(
            &first,
            "version: v1\nname: one\ntrigger:\n  type: manual\nsteps:\n  - id: first\n    type: constant\n    params:\n      value: 1\n    next: []\n",
        )
        .expect("first workflow should be written");
        fs::write(
            &second,
            "version: v1\nname: two\ntrigger:\n  type: manual\nsteps:\n  - id: second\n    type: constant\n    params:\n      value: 2\n    next: []\n",
        )
        .expect("second workflow should be written");

        let workflows = load_workflows_from_dir(&temp_dir).expect("directory loading should work");

        assert_eq!(workflows.len(), 2);
        assert_eq!(workflows[0].name, "one");
        assert_eq!(workflows[1].name, "two");

        fs::remove_dir_all(temp_dir).expect("temp directory cleanup should succeed");
    }

    #[test]
    fn rejects_duplicate_step_ids() {
        let workflow = Workflow {
            version: "v1".to_string(),
            name: "duplicate-step".to_string(),
            trigger: Trigger { r#type: "manual".to_string(), details: Default::default() },
            steps: vec![
                Step {
                    id: "shared".to_string(),
                    r#type: "constant".to_string(),
                    params: serde_yaml::Value::Null,
                    next: vec![],
                    retry: None,
                    timeout_ms: None,
                },
                Step {
                    id: "shared".to_string(),
                    r#type: "constant".to_string(),
                    params: serde_yaml::Value::Null,
                    next: vec![],
                    retry: Some(RetryPolicy { attempts: 1, backoff_ms: 100 }),
                    timeout_ms: None,
                },
            ],
        };

        let error = validate_workflow(&workflow).expect_err("duplicate ids should fail");

        assert!(matches!(
            error,
            EngineError::DuplicateStepId { step_id } if step_id == "shared"
        ));
    }

    #[test]
    fn rejects_webhook_triggers_without_secret_env() {
        let workflow = Workflow {
            version: "v1".to_string(),
            name: "missing-secret".to_string(),
            trigger: Trigger { r#type: "webhook".to_string(), details: Default::default() },
            steps: vec![Step {
                id: "start".to_string(),
                r#type: "constant".to_string(),
                params: serde_yaml::to_value(json!({ "value": true }))
                    .expect("json should convert to yaml"),
                next: vec![],
                retry: None,
                timeout_ms: None,
            }],
        };

        let error = validate_workflow(&workflow).expect_err("webhook trigger should be rejected");

        assert!(matches!(
            error,
            EngineError::MissingTriggerDetail { trigger_type: "webhook", detail: "secret_env" }
        ));
    }

    #[test]
    fn rejects_cycles_during_planning() {
        let workflow = Workflow {
            version: "v1".to_string(),
            name: "cycle".to_string(),
            trigger: Trigger { r#type: "manual".to_string(), details: Default::default() },
            steps: vec![
                Step {
                    id: "a".to_string(),
                    r#type: "constant".to_string(),
                    params: serde_yaml::Value::Null,
                    next: vec!["b".to_string()],
                    retry: None,
                    timeout_ms: None,
                },
                Step {
                    id: "b".to_string(),
                    r#type: "constant".to_string(),
                    params: serde_yaml::Value::Null,
                    next: vec!["a".to_string()],
                    retry: None,
                    timeout_ms: None,
                },
            ],
        };

        let error = compile_workflow(workflow).expect_err("cycles should be rejected");

        assert!(matches!(error, EngineError::GraphCycleDetected { .. }));
    }

    #[tokio::test]
    async fn executes_branching_workflow_and_records_step_runs() {
        let workflow = Workflow {
            version: "v1".to_string(),
            name: "branching".to_string(),
            trigger: Trigger { r#type: "manual".to_string(), details: Default::default() },
            steps: vec![
                step(
                    "seed",
                    "constant",
                    json!({ "value": { "seed": "ready" } }),
                    vec!["left", "right"],
                ),
                step("left", "echo", json!({}), vec!["join"]),
                step("right", "echo", json!({}), vec!["join"]),
                step("join", "echo", json!({}), vec![]),
            ],
        };
        let plan = compile_workflow(workflow).expect("workflow should plan");
        let temp_db = temp_db_path("branching");
        let store = RunStore::connect(&temp_db).await.expect("sqlite should initialize");

        let registry = NodeRegistry::built_in(BuiltInNodeConfig::default());
        registry.register(EchoNode);

        let engine =
            WorkflowEngine::with_registry(store.clone(), registry, ExecutionConfig::default());
        let summary = engine
            .execute_plan(&plan, json!({ "trigger": "manual" }))
            .await
            .expect("workflow should execute");

        let runs = store.list_runs().await.expect("runs should be queryable");
        let step_runs =
            store.list_step_runs(&summary.run_id).await.expect("step runs should be queryable");

        assert_eq!(summary.completed_steps, 4);
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, "success");
        assert_eq!(step_runs.len(), 4);

        cleanup_file(temp_db);
    }

    #[tokio::test]
    async fn condition_nodes_skip_unselected_branches_and_record_them() {
        let workflow = Workflow {
            version: "v1".to_string(),
            name: "conditional-branch".to_string(),
            trigger: Trigger { r#type: "manual".to_string(), details: Default::default() },
            steps: vec![
                step("seed", "constant", json!({ "value": { "amount": 250 } }), vec!["decide"]),
                step(
                    "decide",
                    "condition",
                    json!({
                        "path": "seed.amount",
                        "operator": "gt",
                        "value": 100,
                        "when_true": "high",
                        "when_false": "low"
                    }),
                    vec!["high", "low"],
                ),
                step("high", "echo", json!({ "branch": "high" }), vec!["join"]),
                step("low", "echo", json!({ "branch": "low" }), vec!["join"]),
                step("join", "echo", json!({}), vec![]),
            ],
        };
        let plan = compile_workflow(workflow).expect("workflow should plan");
        let temp_db = temp_db_path("conditional");
        let store = RunStore::connect(&temp_db).await.expect("sqlite should initialize");

        let registry = NodeRegistry::built_in(BuiltInNodeConfig::default());
        registry.register(EchoNode);

        let engine =
            WorkflowEngine::with_registry(store.clone(), registry, ExecutionConfig::default());
        let summary = engine
            .execute_plan(&plan, json!({ "trigger": "manual" }))
            .await
            .expect("workflow should execute");
        let step_runs =
            store.list_step_runs(&summary.run_id).await.expect("step runs should be queryable");

        assert_eq!(summary.completed_steps, 4);
        assert_eq!(summary.outputs["high"]["params"]["branch"], json!("high"));
        assert_eq!(summary.outputs["low"], Value::Null);
        assert!(step_runs
            .iter()
            .any(|record| record.step_id == "low" && record.status == "skipped"));

        cleanup_file(temp_db);
    }

    #[tokio::test]
    async fn retries_a_flaky_step_and_eventually_succeeds() {
        let workflow = Workflow {
            version: "v1".to_string(),
            name: "retries".to_string(),
            trigger: Trigger { r#type: "manual".to_string(), details: Default::default() },
            steps: vec![Step {
                id: "flaky".to_string(),
                r#type: "flaky".to_string(),
                params: serde_yaml::to_value(json!({ "value": "ok" }))
                    .expect("json should convert to yaml"),
                next: vec![],
                retry: Some(RetryPolicy { attempts: 2, backoff_ms: 1 }),
                timeout_ms: Some(1_000),
            }],
        };
        let plan = compile_workflow(workflow).expect("workflow should plan");
        let temp_db = temp_db_path("retries");
        let store = RunStore::connect(&temp_db).await.expect("sqlite should initialize");

        let registry = NodeRegistry::new();
        registry.register(FlakyNode::new(1));

        let engine =
            WorkflowEngine::with_registry(store.clone(), registry, ExecutionConfig::default());
        let summary = engine
            .execute_plan(&plan, json!({}))
            .await
            .expect("workflow should succeed after a retry");

        let step_runs =
            store.list_step_runs(&summary.run_id).await.expect("step runs should be queryable");

        assert_eq!(step_runs.len(), 2);
        assert_eq!(step_runs[0].status, "failed");
        assert_eq!(step_runs[1].status, "success");

        cleanup_file(temp_db);
    }

    fn cleanup_file(path: PathBuf) {
        if path.exists() {
            fs::remove_file(path).expect("temp file cleanup should succeed");
        }
    }

    fn step(id: &str, node_type: &str, params: Value, next: Vec<&str>) -> Step {
        Step {
            id: id.to_string(),
            r#type: node_type.to_string(),
            params: serde_yaml::to_value(params).expect("json should convert to yaml"),
            next: next.into_iter().map(str::to_string).collect(),
            retry: None,
            timeout_ms: Some(1_000),
        }
    }

    fn temp_db_path(label: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("{label}-{}.db", unique_suffix()));
        path
    }

    fn unique_suffix() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos()
    }

    fn write_temp_directory(label: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("acsa-{label}-{}", unique_suffix()));
        fs::create_dir_all(&path).expect("temp directory should be created");
        path
    }

    fn write_temp_workflow(file_name: &str, contents: &str) -> PathBuf {
        let directory = write_temp_directory("workflow");
        let path = directory.join(file_name);
        fs::write(&path, contents.trim()).expect("temp workflow file should be written");
        path
    }

    #[derive(Debug, Clone, Copy)]
    struct EchoNode;

    #[async_trait]
    impl Node for EchoNode {
        fn type_name(&self) -> &'static str {
            "echo"
        }

        async fn execute(&self, inputs: &Value, params: &Value) -> Result<Value, NodeError> {
            Ok(json!({
                "inputs": inputs,
                "params": params
            }))
        }
    }

    #[derive(Clone)]
    struct FlakyNode {
        fail_until: usize,
        attempts: Arc<AtomicUsize>,
    }

    impl FlakyNode {
        fn new(fail_until: usize) -> Self {
            Self { fail_until, attempts: Arc::new(AtomicUsize::new(0)) }
        }
    }

    #[async_trait]
    impl Node for FlakyNode {
        fn type_name(&self) -> &'static str {
            "flaky"
        }

        async fn execute(&self, _inputs: &Value, params: &Value) -> Result<Value, NodeError> {
            let current = self.attempts.fetch_add(1, Ordering::SeqCst);
            if current < self.fail_until {
                return Err(NodeError::Message { message: "transient failure".to_string() });
            }

            Ok(params.get("value").cloned().unwrap_or(Value::Null))
        }
    }
}
