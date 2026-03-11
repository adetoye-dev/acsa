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

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Workflow {
    #[serde(default = "default_workflow_version")]
    pub version: String,
    pub name: String,
    pub trigger: Trigger,
    #[serde(default)]
    pub steps: Vec<Step>,
    #[serde(default, skip_serializing_if = "WorkflowUi::is_empty")]
    pub ui: WorkflowUi,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct WorkflowUi {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub detached_steps: Vec<String>,
}

impl WorkflowUi {
    pub fn is_empty(&self) -> bool {
        self.detached_steps.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Trigger {
    #[serde(rename = "type")]
    pub r#type: String,
    #[serde(flatten, default)]
    pub details: BTreeMap<String, serde_yaml::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Step {
    pub id: String,
    #[serde(rename = "type")]
    pub r#type: String,
    #[serde(default = "default_params")]
    pub params: serde_yaml::Value,
    #[serde(default)]
    pub next: Vec<String>,
    #[serde(default)]
    pub retry: Option<RetryPolicy>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RetryPolicy {
    pub attempts: u32,
    #[serde(default)]
    pub backoff_ms: u64,
}

pub fn default_workflow_version() -> String {
    "v1".to_string()
}

fn default_params() -> serde_yaml::Value {
    serde_yaml::Value::Mapping(Default::default())
}
