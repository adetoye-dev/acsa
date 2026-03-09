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

mod ai;
mod human;
mod integration;
mod logic;

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
    time::{Duration, Instant},
};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use thiserror::Error;
use tokio::{
    sync::{Mutex, OwnedSemaphorePermit, Semaphore},
    time::sleep,
};

use self::{
    ai::{ClassificationNode, EmbeddingNode, ExtractionNode, LlmCompletionNode, RetrievalNode},
    human::{ApprovalNode, ManualInputNode},
    integration::{DatabaseQueryNode, FileReadNode, FileWriteNode, HttpRequestNode},
    logic::{ConditionNode, LoopNode, ParallelNode, SwitchNode},
};

type RegistryMap = Arc<RwLock<HashMap<String, Arc<dyn Node>>>>;

const CONTROL_FIELD: &str = "__acsa";
const PAUSE_FIELD: &str = "__acsa_pause";
const WRAPPED_FIELD: &str = "__acsa_wrapped";

#[async_trait]
pub trait Node: Send + Sync {
    fn type_name(&self) -> &str;

    async fn execute(&self, inputs: &Value, params: &Value) -> Result<Value, NodeError>;
}

#[derive(Clone)]
pub struct NodeRegistry {
    nodes: RegistryMap,
}

impl Default for NodeRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl NodeRegistry {
    pub fn new() -> Self {
        Self { nodes: Arc::new(RwLock::new(HashMap::new())) }
    }

    pub fn built_in(config: BuiltInNodeConfig) -> Self {
        let registry = Self::new();
        let shared_store = Arc::new(Mutex::new(VectorStore::default()));
        let http_limiter = RateLimiter::default();
        let llm_limiter = RateLimiter::default();

        registry.register(ConstantNode);
        registry.register(NoopNode);
        registry.register(ConditionNode);
        registry.register(SwitchNode);
        registry.register(LoopNode::new(registry.nodes.clone()));
        registry.register(ParallelNode::new(registry.nodes.clone()));
        registry.register(HttpRequestNode::new(http_limiter.clone()));
        registry.register(DatabaseQueryNode::new(config.data_dir.clone()));
        registry.register(FileReadNode::new(config.data_dir.clone()));
        registry.register(FileWriteNode::new(config.data_dir.clone()));
        registry.register(LlmCompletionNode::new(llm_limiter.clone()));
        registry.register(ClassificationNode::new());
        registry.register(ExtractionNode::new());
        registry.register(EmbeddingNode::new(shared_store.clone()));
        registry.register(RetrievalNode::new(shared_store));
        registry.register(ApprovalNode);
        registry.register(ManualInputNode);

        registry
    }

    pub fn register<N>(&self, node: N)
    where
        N: Node + 'static,
    {
        let mut guard = self.nodes.write().expect("node registry lock should not be poisoned");
        guard.insert(node.type_name().to_string(), Arc::new(node));
    }

    pub fn get(&self, type_name: &str) -> Option<Arc<dyn Node>> {
        self.nodes
            .read()
            .expect("node registry lock should not be poisoned")
            .get(type_name)
            .cloned()
    }
}

#[derive(Debug, Clone)]
pub struct BuiltInNodeConfig {
    pub data_dir: PathBuf,
}

impl Default for BuiltInNodeConfig {
    fn default() -> Self {
        Self { data_dir: PathBuf::from("data") }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct NodeControl {
    #[serde(default)]
    pub next: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodePauseKind {
    Approval,
    ManualInput,
}

impl NodePauseKind {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Approval => "approval",
            Self::ManualInput => "manual_input",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NodePause {
    #[serde(default)]
    pub details: Value,
    #[serde(default)]
    pub field: Option<String>,
    pub kind: NodePauseKind,
    pub prompt: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NodeOutcome {
    pub control: NodeControl,
    pub pause: Option<NodePause>,
    pub payload: Value,
}

pub fn controlled_output(payload: Value, control: NodeControl) -> Result<Value, NodeError> {
    if control.next.is_empty() {
        return Ok(payload);
    }

    let control_value = serde_json::to_value(&control).map_err(|error| NodeError::Message {
        message: format!("failed to encode node control metadata: {error}"),
    })?;

    match payload {
        Value::Object(mut object) => {
            object.insert(CONTROL_FIELD.to_string(), control_value);
            object.insert(WRAPPED_FIELD.to_string(), Value::Bool(true));
            Ok(Value::Object(object))
        }
        other => Ok(json!({
            CONTROL_FIELD: control_value,
            WRAPPED_FIELD: true,
            "payload": other
        })),
    }
}

pub fn paused_output(pause: NodePause) -> Result<Value, NodeError> {
    let pause_value = serde_json::to_value(&pause).map_err(|error| NodeError::Message {
        message: format!("failed to encode pause metadata: {error}"),
    })?;

    Ok(json!({
        PAUSE_FIELD: pause_value,
        WRAPPED_FIELD: true,
        "payload": Value::Null
    }))
}

pub fn split_control(output: Value) -> Result<NodeOutcome, NodeError> {
    match output {
        Value::Object(mut object) => {
            let was_wrapped =
                object.remove(WRAPPED_FIELD).and_then(|value| value.as_bool()).unwrap_or(false);
            if !was_wrapped {
                return Ok(NodeOutcome {
                    control: NodeControl::default(),
                    pause: None,
                    payload: Value::Object(object),
                });
            };
            let control = object
                .remove(CONTROL_FIELD)
                .map(|value| {
                    serde_json::from_value::<NodeControl>(value).map_err(|error| {
                        NodeError::Message {
                            message: format!("failed to decode node control metadata: {error}"),
                        }
                    })
                })
                .transpose()?
                .unwrap_or_default();
            let pause = object
                .remove(PAUSE_FIELD)
                .map(|value| {
                    serde_json::from_value::<NodePause>(value).map_err(|error| NodeError::Message {
                        message: format!("failed to decode pause metadata: {error}"),
                    })
                })
                .transpose()?;
            let payload = match object.remove("payload") {
                Some(payload) if object.is_empty() => payload,
                Some(payload) => {
                    object.insert("payload".to_string(), payload);
                    Value::Object(object)
                }
                None => Value::Object(object),
            };

            Ok(NodeOutcome { control, pause, payload })
        }
        other => Ok(NodeOutcome { control: NodeControl::default(), pause: None, payload: other }),
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct NoopNode;

#[async_trait]
impl Node for NoopNode {
    fn type_name(&self) -> &'static str {
        "noop"
    }

    async fn execute(&self, inputs: &Value, params: &Value) -> Result<Value, NodeError> {
        Ok(json!({
            "inputs": inputs,
            "params": params,
            "status": "noop"
        }))
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ConstantNode;

#[async_trait]
impl Node for ConstantNode {
    fn type_name(&self) -> &'static str {
        "constant"
    }

    async fn execute(&self, _inputs: &Value, params: &Value) -> Result<Value, NodeError> {
        params.get("value").cloned().ok_or(NodeError::MissingParameter { parameter: "value" })
    }
}

#[derive(Debug, Clone, Default)]
pub struct RateLimiter {
    next_ready: Arc<Mutex<Option<Instant>>>,
}

impl RateLimiter {
    pub async fn acquire(
        &self,
        requests_per_second: Option<f64>,
        semaphore: Option<&Arc<Semaphore>>,
    ) -> Result<Option<OwnedSemaphorePermit>, NodeError> {
        if let Some(limit) = requests_per_second {
            if !(limit.is_finite() && limit > 0.0) {
                return Err(NodeError::InvalidParameter {
                    parameter: "rate_limit_per_second".to_string(),
                    message: "rate limit must be a positive finite number".to_string(),
                });
            }

            let spacing = Duration::from_secs_f64(1.0 / limit);
            let mut guard = self.next_ready.lock().await;
            let now = Instant::now();
            if let Some(next_ready) = *guard {
                if next_ready > now {
                    sleep(next_ready.duration_since(now)).await;
                }
            }
            *guard = Some(Instant::now() + spacing);
        }

        if let Some(semaphore) = semaphore {
            let permit =
                semaphore.clone().acquire_owned().await.map_err(|_| NodeError::Message {
                    message: "rate-limit semaphore was unexpectedly closed".to_string(),
                })?;
            return Ok(Some(permit));
        }

        Ok(None)
    }
}

#[derive(Debug, Clone)]
pub struct EmbeddedDocument {
    pub id: String,
    pub metadata: Value,
    pub text: String,
    pub vector: Vec<f64>,
}

#[derive(Debug, Default)]
pub struct VectorStore {
    collections: HashMap<String, Vec<EmbeddedDocument>>,
}

impl VectorStore {
    pub fn insert(&mut self, collection: &str, document: EmbeddedDocument) {
        self.collections.entry(collection.to_string()).or_default().push(document);
    }

    pub fn query(&self, collection: &str) -> &[EmbeddedDocument] {
        self.collections.get(collection).map_or(&[], Vec::as_slice)
    }
}

#[derive(Debug, Error)]
pub enum NodeError {
    #[error("missing required parameter {parameter}")]
    MissingParameter { parameter: &'static str },
    #[error("invalid parameter {parameter}: {message}")]
    InvalidParameter { message: String, parameter: String },
    #[error("missing required input value at {path}")]
    MissingInputPath { path: String },
    #[error("operation blocked for security reasons: {message}")]
    SecurityViolation { message: String },
    #[error("{message}")]
    Message { message: String },
}

pub(crate) fn as_array<'a>(
    value: &'a Value,
    parameter: &'static str,
) -> Result<&'a [Value], NodeError> {
    value.as_array().map(Vec::as_slice).ok_or(NodeError::InvalidParameter {
        parameter: parameter.to_string(),
        message: "expected an array".to_string(),
    })
}

pub(crate) fn as_object<'a>(
    value: &'a Value,
    parameter: &'static str,
) -> Result<&'a Map<String, Value>, NodeError> {
    value.as_object().ok_or(NodeError::InvalidParameter {
        parameter: parameter.to_string(),
        message: "expected an object".to_string(),
    })
}

pub(crate) fn as_string<'a>(
    value: &'a Value,
    parameter: &'static str,
) -> Result<&'a str, NodeError> {
    value.as_str().ok_or(NodeError::InvalidParameter {
        parameter: parameter.to_string(),
        message: "expected a string".to_string(),
    })
}

pub(crate) fn cosine_similarity(left: &[f64], right: &[f64]) -> f64 {
    if left.is_empty() || right.is_empty() || left.len() != right.len() {
        return 0.0;
    }

    let mut dot = 0.0;
    let mut left_norm = 0.0;
    let mut right_norm = 0.0;
    for (left_value, right_value) in left.iter().zip(right.iter()) {
        dot += left_value * right_value;
        left_norm += left_value * left_value;
        right_norm += right_value * right_value;
    }

    if left_norm == 0.0 || right_norm == 0.0 {
        return 0.0;
    }

    dot / (left_norm.sqrt() * right_norm.sqrt())
}

pub(crate) fn ensure_relative_path(root: &Path, relative_path: &str) -> Result<PathBuf, NodeError> {
    let path = PathBuf::from(relative_path);
    if path.is_absolute() {
        return Err(NodeError::SecurityViolation {
            message: "absolute paths are not allowed".to_string(),
        });
    }

    let mut sanitized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::Normal(part) => sanitized.push(part),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                return Err(NodeError::SecurityViolation {
                    message: "path traversal is not allowed".to_string(),
                });
            }
            _ => {
                return Err(NodeError::SecurityViolation {
                    message: "unsupported path component".to_string(),
                });
            }
        }
    }

    Ok(root.join(sanitized))
}

pub(crate) fn embed_text(text: &str) -> Vec<f64> {
    let mut vector = vec![0.0; 32];
    for token in text.split_whitespace() {
        let mut hash = 0_u64;
        for byte in token.as_bytes() {
            hash = hash.wrapping_mul(37).wrapping_add(u64::from(*byte));
        }
        let index = (hash as usize) % vector.len();
        vector[index] += 1.0;
    }
    vector
}

pub(crate) fn lookup_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    if path.is_empty() {
        return Some(value);
    }

    let mut current = value;
    for segment in path.split('.') {
        if segment.is_empty() {
            continue;
        }
        match current {
            Value::Object(object) => current = object.get(segment)?,
            Value::Array(array) => {
                let index: usize = segment.parse().ok()?;
                current = array.get(index)?;
            }
            _ => return None,
        }
    }
    Some(current)
}

pub(crate) fn lookup_required<'a>(value: &'a Value, path: &str) -> Result<&'a Value, NodeError> {
    lookup_path(value, path).ok_or_else(|| NodeError::MissingInputPath { path: path.to_string() })
}

pub(crate) fn parse_usize(value: Option<u64>, parameter: &str) -> Result<Option<usize>, NodeError> {
    value
        .map(|raw| {
            usize::try_from(raw).map_err(|_| NodeError::InvalidParameter {
                parameter: parameter.to_string(),
                message: "value does not fit into usize".to_string(),
            })
        })
        .transpose()
}

pub(crate) fn take_string_list(
    value: &Value,
    parameter: &'static str,
) -> Result<Vec<String>, NodeError> {
    as_array(value, parameter)?
        .iter()
        .map(|entry| as_string(entry, parameter).map(str::to_string))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{controlled_output, ensure_relative_path, lookup_path, split_control, NodeControl};
    use serde_json::json;
    use std::path::Path;

    #[test]
    fn extracts_control_metadata_from_object_outputs() {
        let output = controlled_output(
            json!({ "matched": true }),
            NodeControl { next: vec!["high".to_string()] },
        )
        .expect("control output should serialize");
        let outcome = split_control(output).expect("control output should parse");

        assert_eq!(outcome.control.next, vec!["high".to_string()]);
        assert_eq!(outcome.payload, json!({ "matched": true }));
    }

    #[test]
    fn looks_up_nested_values_using_dot_paths() {
        let value = json!({
            "payload": {
                "items": [
                    { "name": "alpha" },
                    { "name": "beta" }
                ]
            }
        });

        let resolved = lookup_path(&value, "payload.items.1.name").expect("path should resolve");

        assert_eq!(resolved, "beta");
    }

    #[test]
    fn rejects_parent_directory_traversal() {
        let result = ensure_relative_path(Path::new("data"), "../secret.txt");

        assert!(result.is_err());
    }
}
