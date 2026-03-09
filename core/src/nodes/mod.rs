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

use std::{collections::HashMap, sync::Arc};

use async_trait::async_trait;
use serde_json::{json, Value};
use thiserror::Error;

#[async_trait]
pub trait Node: Send + Sync {
    fn type_name(&self) -> &'static str;

    async fn execute(&self, inputs: &Value, params: &Value) -> Result<Value, NodeError>;
}

#[derive(Clone, Default)]
pub struct NodeRegistry {
    nodes: HashMap<String, Arc<dyn Node>>,
}

impl NodeRegistry {
    pub fn new() -> Self {
        Self { nodes: HashMap::new() }
    }

    pub fn built_in() -> Self {
        let mut registry = Self::new();
        registry.register(ConstantNode);
        registry.register(NoopNode);
        registry
    }

    pub fn register<N>(&mut self, node: N)
    where
        N: Node + 'static,
    {
        self.nodes.insert(node.type_name().to_string(), Arc::new(node));
    }

    pub fn get(&self, type_name: &str) -> Option<Arc<dyn Node>> {
        self.nodes.get(type_name).cloned()
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
        match params.get("value") {
            Some(value) => Ok(value.clone()),
            None => Err(NodeError::MissingParameter { parameter: "value" }),
        }
    }
}

#[derive(Debug, Error)]
pub enum NodeError {
    #[error("missing required parameter {parameter}")]
    MissingParameter { parameter: &'static str },
    #[error("{message}")]
    Message { message: String },
}
