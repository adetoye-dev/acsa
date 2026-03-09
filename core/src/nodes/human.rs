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

use async_trait::async_trait;
use serde_json::{json, Value};

use super::{lookup_required, paused_output, Node, NodeError, NodePause, NodePauseKind};

#[derive(Debug, Clone, Copy, Default)]
pub struct ApprovalNode;

#[async_trait]
impl Node for ApprovalNode {
    fn type_name(&self) -> &'static str {
        "approval"
    }

    async fn execute(&self, inputs: &Value, params: &Value) -> Result<Value, NodeError> {
        let prompt = params
            .get("prompt")
            .and_then(Value::as_str)
            .ok_or(NodeError::MissingParameter { parameter: "prompt" })?;
        let approved = params.get("approved").and_then(Value::as_bool).or_else(|| {
            params
                .get("approved_path")
                .and_then(Value::as_str)
                .and_then(|path| lookup_required(inputs, path).ok())
                .and_then(Value::as_bool)
        });
        if let Some(approved) = approved {
            return Ok(json!({ "approved": approved, "prompt": prompt }));
        }

        paused_output(NodePause {
            details: params.get("details").cloned().unwrap_or_else(|| json!({})),
            field: None,
            kind: NodePauseKind::Approval,
            prompt: prompt.to_string(),
        })
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ManualInputNode;

#[async_trait]
impl Node for ManualInputNode {
    fn type_name(&self) -> &'static str {
        "manual_input"
    }

    async fn execute(&self, inputs: &Value, params: &Value) -> Result<Value, NodeError> {
        let prompt = params
            .get("prompt")
            .and_then(Value::as_str)
            .ok_or(NodeError::MissingParameter { parameter: "prompt" })?;
        let field = params
            .get("field")
            .and_then(Value::as_str)
            .ok_or(NodeError::MissingParameter { parameter: "field" })?;
        let value = params.get("value").cloned().or_else(|| {
            params
                .get("value_path")
                .and_then(Value::as_str)
                .and_then(|path| lookup_required(inputs, path).ok())
                .cloned()
        });
        if let Some(value) = value {
            return Ok(json!({ "field": field, "prompt": prompt, "value": value }));
        }

        paused_output(NodePause {
            details: params.get("details").cloned().unwrap_or_else(|| json!({})),
            field: Some(field.to_string()),
            kind: NodePauseKind::ManualInput,
            prompt: prompt.to_string(),
        })
    }
}
