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

use std::fs;

use serde_json::json;

use acsa_core::{
    cli::{Cli, CliError, Command},
    connectors::{run_manifest_path, scaffold_connector, ConnectorRuntime},
    engine::{
        compile_workflow, load_workflow_from_path, load_workflows_from_dir, ExecutionConfig,
        WorkflowEngine,
    },
    observability::init_tracing,
    triggers::{serve, TriggerServerConfig},
};

type MainError = Box<dyn std::error::Error>;

#[tokio::main]
async fn main() -> Result<(), MainError> {
    init_tracing();
    let cli = match Cli::from_env() {
        Ok(cli) => cli,
        Err(CliError::HelpRequested) => {
            println!("{}", Cli::usage());
            return Ok(());
        }
        Err(error) => return Err(error.into()),
    };

    match cli.command {
        Command::ConnectorNew { connectors_dir, name, runtime, type_id } => {
            let runtime = parse_connector_runtime(&runtime)?;
            let connector_dir = scaffold_connector(&connectors_dir, &name, &type_id, runtime)
                .map_err(|error| -> MainError { Box::new(error) })?;
            println!(
                "Scaffolded connector '{}' ({}) in {}",
                type_id,
                runtime_name(runtime),
                connector_dir.display()
            );
        }
        Command::ConnectorTest { inputs_path, manifest_path, params_path } => {
            let inputs = load_json_file(inputs_path.as_deref())
                .map_err(|error| -> MainError { Box::new(error) })?;
            let params = load_json_file(params_path.as_deref())
                .map_err(|error| -> MainError { Box::new(error) })?;
            let output = run_manifest_path(&manifest_path, inputs, params)
                .await
                .map_err(|error| -> MainError { Box::new(error) })?;
            println!("{}", serde_json::to_string_pretty(&output)?);
        }
        Command::List { workflows_dir } => {
            let workflows = load_workflows_from_dir(&workflows_dir)
                .map_err(|error| -> MainError { Box::new(error) })?;
            println!("Loaded {} workflow(s) from {}", workflows.len(), workflows_dir.display());
            for workflow in workflows {
                println!(
                    "- {} (trigger: {}, steps: {})",
                    workflow.name,
                    workflow.trigger.r#type,
                    workflow.steps.len()
                );
            }
        }
        Command::Run { database_path, max_concurrency, workflow_path } => {
            let config = ExecutionConfig { max_concurrency, ..ExecutionConfig::default() };
            let engine = WorkflowEngine::new(&database_path, config)
                .await
                .map_err(|error| -> MainError { Box::new(error) })?;
            let summary = engine
                .execute_workflow_path(
                    &workflow_path,
                    json!({
                        "source": "manual_cli",
                        "workflow_path": workflow_path.display().to_string()
                    }),
                )
                .await
                .map_err(|error| -> MainError { Box::new(error) })?;

            match summary.status {
                acsa_core::engine::ExecutionStatus::Success => {
                    println!(
                        "Run {} completed for '{}' with {} step(s)",
                        summary.run_id, summary.workflow_name, summary.completed_steps
                    );
                }
                acsa_core::engine::ExecutionStatus::Paused => {
                    println!(
                        "Run {} paused for '{}' after {} completed step(s)",
                        summary.run_id, summary.workflow_name, summary.completed_steps
                    );
                    println!(
                        "Pending human tasks: {}",
                        serde_json::to_string_pretty(&summary.pending_tasks)?
                    );
                }
            }
            println!("SQLite state written to {}", database_path.display());
        }
        Command::Serve { database_path, host, max_concurrency, port, workflows_dir } => {
            let config = ExecutionConfig { max_concurrency, ..ExecutionConfig::default() };
            let bind_addr = format!("{host}:{port}")
                .parse()
                .map_err(|error| -> MainError { Box::new(error) })?;
            let engine = WorkflowEngine::new(&database_path, config)
                .await
                .map_err(|error| -> MainError { Box::new(error) })?;

            println!("Serving workflows from {} on http://{}", workflows_dir.display(), bind_addr);
            println!("SQLite state written to {}", database_path.display());

            serve(engine, TriggerServerConfig { bind_addr, workflows_dir })
                .await
                .map_err(|error| -> MainError { Box::new(error) })?;
        }
        Command::Validate { workflow_path } => {
            let workflow = load_workflow_from_path(&workflow_path)
                .map_err(|error| -> MainError { Box::new(error) })?;
            let plan =
                compile_workflow(workflow).map_err(|error| -> MainError { Box::new(error) })?;
            println!(
                "Validated workflow '{}' (trigger: {}, steps: {}, order: {:?}) from {}",
                plan.workflow.name,
                plan.workflow.trigger.r#type,
                plan.workflow.steps.len(),
                plan.order(),
                workflow_path.display()
            );
        }
    }

    Ok(())
}

fn load_json_file(path: Option<&std::path::Path>) -> Result<serde_json::Value, std::io::Error> {
    match path {
        Some(path) => {
            let raw = fs::read_to_string(path)?;
            let parsed = serde_json::from_str(&raw).map_err(std::io::Error::other)?;
            Ok(parsed)
        }
        None => Ok(json!({})),
    }
}

fn parse_connector_runtime(runtime: &str) -> Result<ConnectorRuntime, MainError> {
    match runtime {
        "process" => Ok(ConnectorRuntime::Process),
        "wasm" => Ok(ConnectorRuntime::Wasm),
        other => Err(format!("unsupported connector runtime {other}").into()),
    }
}

const fn runtime_name(runtime: ConnectorRuntime) -> &'static str {
    match runtime {
        ConnectorRuntime::Process => "process",
        ConnectorRuntime::Wasm => "wasm",
    }
}
