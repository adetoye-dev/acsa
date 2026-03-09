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

use std::sync::{Arc, RwLock};

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::task::JoinSet;

use super::{
    as_array, as_object, controlled_output, lookup_path, lookup_required, parse_usize,
    split_control, Node, NodeControl, NodeError,
};

type RegistryMap = Arc<RwLock<std::collections::HashMap<String, Arc<dyn Node>>>>;

#[derive(Debug, Clone, Copy, Default)]
pub struct ConditionNode;

#[async_trait]
impl Node for ConditionNode {
    fn type_name(&self) -> &'static str {
        "condition"
    }

    async fn execute(&self, inputs: &Value, params: &Value) -> Result<Value, NodeError> {
        let path = params.get("path").map_or("", |value| value.as_str().unwrap_or(""));
        let operator = params.get("operator").map_or("eq", |value| value.as_str().unwrap_or("eq"));
        let actual = lookup_path(inputs, path).cloned().unwrap_or(Value::Null);
        let expected = params.get("value").cloned().unwrap_or(Value::Bool(true));
        let matched = compare_values(&actual, operator, &expected)?;
        let next = match matched {
            true => params.get("when_true").and_then(Value::as_str).map(str::to_string),
            false => params.get("when_false").and_then(Value::as_str).map(str::to_string),
        };

        controlled_output(
            json!({ "matched": matched, "value": actual }),
            NodeControl { next: next.into_iter().collect() },
        )
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SwitchNode;

#[async_trait]
impl Node for SwitchNode {
    fn type_name(&self) -> &'static str {
        "switch"
    }

    async fn execute(&self, inputs: &Value, params: &Value) -> Result<Value, NodeError> {
        let path = params
            .get("path")
            .and_then(Value::as_str)
            .ok_or(NodeError::MissingParameter { parameter: "path" })?;
        let raw_value = lookup_required(inputs, path)?;
        let lookup_key = match raw_value {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        };
        let cases = as_object(
            params.get("cases").ok_or(NodeError::MissingParameter { parameter: "cases" })?,
            "cases",
        )?;
        let selected = cases
            .get(&lookup_key)
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| params.get("default").and_then(Value::as_str).map(str::to_string));

        controlled_output(
            json!({ "selected": lookup_key, "value": raw_value }),
            NodeControl { next: selected.into_iter().collect() },
        )
    }
}

#[derive(Clone)]
pub struct LoopNode {
    registry: RegistryMap,
}

impl LoopNode {
    pub fn new(registry: RegistryMap) -> Self {
        Self { registry }
    }
}

#[async_trait]
impl Node for LoopNode {
    fn type_name(&self) -> &'static str {
        "loop"
    }

    async fn execute(&self, inputs: &Value, params: &Value) -> Result<Value, NodeError> {
        let items = resolve_items(inputs, params)?;
        let max_iterations =
            parse_usize(params.get("max_iterations").and_then(Value::as_u64), "max_iterations")?
                .unwrap_or(100);
        if items.len() > max_iterations {
            return Err(NodeError::InvalidParameter {
                parameter: "max_iterations".to_string(),
                message: format!(
                    "loop would exceed the configured iteration cap of {max_iterations}"
                ),
            });
        }

        let task = params.get("task").ok_or(NodeError::MissingParameter { parameter: "task" })?;
        let spec = TaskSpec::from_value(task)?;
        let node = lookup_node(&self.registry, &spec.node_type)?;

        let mut outputs = Vec::with_capacity(items.len());
        for (index, item) in items.iter().enumerate() {
            let task_input = json!({
                "item": item,
                "index": index,
                "inputs": inputs
            });
            let resolved_input = spec.resolve_input(&task_input)?;
            let output = node.execute(&resolved_input, &spec.params).await?;
            outputs.push(split_control(output)?.payload);
        }

        Ok(json!({ "count": outputs.len(), "items": outputs }))
    }
}

#[derive(Clone)]
pub struct ParallelNode {
    registry: RegistryMap,
}

impl ParallelNode {
    pub fn new(registry: RegistryMap) -> Self {
        Self { registry }
    }
}

#[async_trait]
impl Node for ParallelNode {
    fn type_name(&self) -> &'static str {
        "parallel"
    }

    async fn execute(&self, inputs: &Value, params: &Value) -> Result<Value, NodeError> {
        let tasks = as_array(
            params.get("tasks").ok_or(NodeError::MissingParameter { parameter: "tasks" })?,
            "tasks",
        )?;

        let max_concurrency =
            parse_usize(params.get("max_concurrency").and_then(Value::as_u64), "max_concurrency")?
                .unwrap_or(tasks.len().max(1));
        let semaphore = Arc::new(tokio::sync::Semaphore::new(max_concurrency.max(1)));
        let mut join_set = JoinSet::new();

        for (index, task) in tasks.iter().enumerate() {
            let spec = TaskSpec::from_value(task)?;
            let node = lookup_node(&self.registry, &spec.node_type)?;
            let task_inputs = json!({
                "index": index,
                "inputs": inputs
            });
            let resolved_input = spec.resolve_input(&task_inputs)?;
            let permit = semaphore.clone().acquire_owned().await.map_err(|_| {
                NodeError::Message { message: "parallel semaphore unexpectedly closed".to_string() }
            })?;
            let params = spec.params.clone();
            join_set.spawn(async move {
                let _permit = permit;
                let output = node.execute(&resolved_input, &params).await?;
                Ok::<(usize, Value), NodeError>((index, split_control(output)?.payload))
            });
        }

        let mut ordered = vec![Value::Null; tasks.len()];
        while let Some(joined) = join_set.join_next().await {
            let (index, output) = joined.map_err(|error| NodeError::Message {
                message: format!("parallel child task failed to join: {error}"),
            })??;
            ordered[index] = output;
        }

        Ok(json!({ "count": ordered.len(), "results": ordered }))
    }
}

#[derive(Debug, Clone)]
struct TaskSpec {
    input: Option<Value>,
    input_path: Option<String>,
    node_type: String,
    params: Value,
}

impl TaskSpec {
    fn from_value(value: &Value) -> Result<Self, NodeError> {
        let object = as_object(value, "task")?;
        let node_type = object
            .get("type")
            .and_then(Value::as_str)
            .ok_or(NodeError::MissingParameter { parameter: "task.type" })?
            .to_string();
        let params = object.get("params").cloned().unwrap_or_else(|| json!({}));
        let input_path = object.get("input_path").and_then(Value::as_str).map(str::to_string);
        let input = object.get("input").cloned();

        Ok(Self { input, input_path, node_type, params })
    }

    fn resolve_input(&self, default_input: &Value) -> Result<Value, NodeError> {
        if let Some(path) = &self.input_path {
            return lookup_required(default_input, path).cloned();
        }
        if let Some(input) = &self.input {
            return Ok(input.clone());
        }
        Ok(default_input.clone())
    }
}

fn compare_values(actual: &Value, operator: &str, expected: &Value) -> Result<bool, NodeError> {
    let comparison = match operator {
        "eq" => actual == expected,
        "ne" => actual != expected,
        "contains" => actual
            .as_str()
            .zip(expected.as_str())
            .map(|(text, needle)| text.contains(needle))
            .unwrap_or(false),
        "exists" => !actual.is_null(),
        "gt" => number_value(actual) > number_value(expected),
        "gte" => number_value(actual) >= number_value(expected),
        "lt" => number_value(actual) < number_value(expected),
        "lte" => number_value(actual) <= number_value(expected),
        other => {
            return Err(NodeError::InvalidParameter {
                parameter: "operator".to_string(),
                message: format!("unsupported comparison operator {other}"),
            });
        }
    };

    Ok(comparison)
}

fn lookup_node(registry: &RegistryMap, node_type: &str) -> Result<Arc<dyn Node>, NodeError> {
    registry
        .read()
        .expect("node registry lock should not be poisoned")
        .get(node_type)
        .cloned()
        .ok_or_else(|| NodeError::Message {
            message: format!("unknown child node type {node_type}"),
        })
}

fn number_value(value: &Value) -> f64 {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|number| number as f64))
        .or_else(|| value.as_u64().map(|number| number as f64))
        .unwrap_or(0.0)
}

fn resolve_items(inputs: &Value, params: &Value) -> Result<Vec<Value>, NodeError> {
    if let Some(items) = params.get("items") {
        return Ok(as_array(items, "items")?.to_vec());
    }

    let path = params
        .get("items_path")
        .and_then(Value::as_str)
        .ok_or(NodeError::MissingParameter { parameter: "items_path" })?;
    Ok(as_array(lookup_required(inputs, path)?, "items_path")?.to_vec())
}

#[cfg(test)]
mod tests {
    use super::{ConditionNode, Node, SwitchNode};
    use serde_json::json;

    #[tokio::test]
    async fn condition_node_selects_the_true_branch() {
        let output = ConditionNode
            .execute(
                &json!({ "amount": 250 }),
                &json!({
                    "path": "amount",
                    "operator": "gt",
                    "value": 100,
                    "when_true": "vip",
                    "when_false": "standard"
                }),
            )
            .await
            .expect("condition should evaluate");

        let outcome = crate::nodes::split_control(output).expect("control metadata should parse");

        assert_eq!(outcome.control.next, vec!["vip".to_string()]);
    }

    #[tokio::test]
    async fn switch_node_selects_a_matching_case() {
        let output = SwitchNode
            .execute(
                &json!({ "status": "paid" }),
                &json!({
                    "path": "status",
                    "cases": {
                        "paid": "ship_order"
                    },
                    "default": "queue_review"
                }),
            )
            .await
            .expect("switch should evaluate");

        let outcome = crate::nodes::split_control(output).expect("control metadata should parse");

        assert_eq!(outcome.control.next, vec!["ship_order".to_string()]);
    }
}
