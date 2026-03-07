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

use std::{collections::HashSet, fs, path::Path};

use thiserror::Error;

use crate::models::Workflow;

const SUPPORTED_WORKFLOW_VERSION: &str = "v1";

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
    #[error("unsupported workflow version {version}; expected v1")]
    UnsupportedWorkflowVersion { version: String },
    #[error("workflow name must not be empty")]
    EmptyWorkflowName,
    #[error("workflow trigger type must not be empty")]
    EmptyTriggerType,
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
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{load_workflow_from_path, validate_workflow, EngineError};
    use crate::models::{RetryPolicy, Step, Trigger, Workflow};

    #[test]
    fn loads_and_validates_a_workflow_file() {
        let path = write_temp_workflow(
            r#"
version: v1
name: foundation-check
trigger:
  type: manual
steps:
  - id: start
    type: http_request
    params:
      method: GET
      url: https://example.com
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
    fn rejects_duplicate_step_ids() {
        let workflow = Workflow {
            version: "v1".to_string(),
            name: "duplicate-step".to_string(),
            trigger: Trigger { r#type: "manual".to_string(), details: Default::default() },
            steps: vec![
                Step {
                    id: "shared".to_string(),
                    r#type: "http_request".to_string(),
                    params: serde_yaml::Value::Null,
                    next: vec![],
                    retry: None,
                },
                Step {
                    id: "shared".to_string(),
                    r#type: "http_request".to_string(),
                    params: serde_yaml::Value::Null,
                    next: vec![],
                    retry: Some(RetryPolicy { attempts: 1, backoff_ms: 100 }),
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
    fn rejects_unknown_next_step_references() {
        let workflow = Workflow {
            version: "v1".to_string(),
            name: "invalid-edge".to_string(),
            trigger: Trigger { r#type: "manual".to_string(), details: Default::default() },
            steps: vec![Step {
                id: "start".to_string(),
                r#type: "http_request".to_string(),
                params: serde_yaml::Value::Null,
                next: vec!["missing".to_string()],
                retry: None,
            }],
        };

        let error =
            validate_workflow(&workflow).expect_err("unknown next step references should fail");

        assert!(matches!(
            error,
            EngineError::UnknownNextStep { step_id, next_step }
                if step_id == "start" && next_step == "missing"
        ));
    }

    fn write_temp_workflow(contents: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let mut path = std::env::temp_dir();
        path.push(format!("acsa-workflow-{timestamp}.yaml"));

        fs::write(&path, contents.trim()).expect("temp workflow file should be written");

        path
    }
}
