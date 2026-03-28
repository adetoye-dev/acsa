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

use std::{env, fs, io, path::Path};

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
    version,
};

type MainError = Box<dyn std::error::Error>;

#[tokio::main]
async fn main() {
    if let Err(error) = load_local_env_files() {
        report_error(error.as_ref());
        std::process::exit(1);
    }
    init_tracing();
    if let Err(error) = run().await {
        report_error(error.as_ref());
        std::process::exit(1);
    }
}

fn load_local_env_files() -> Result<(), MainError> {
    let current_dir = env::current_dir()?;
    load_env_file_if_present(&current_dir.join(".env.local"))?;
    load_env_file_if_present(&current_dir.join(".env"))?;
    Ok(())
}

fn load_env_file_if_present(path: &Path) -> Result<(), MainError> {
    if !path.exists() {
        return Ok(());
    }

    dotenvy::from_path(path).map_err(|error| -> MainError { Box::new(error) })?;
    Ok(())
}

async fn run() -> Result<(), MainError> {
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
                "Scaffolded connector source '{}' ({}) in {}",
                type_id,
                runtime_name(runtime),
                connector_dir.display()
            );
            println!("Next steps:");
            println!("  1. Edit {}", connector_dir.join("manifest.json").display());
            println!(
                "  2. Test it with: cargo run -p acsa-core -- connector-test {} --inputs {}",
                connector_dir.join("manifest.json").display(),
                connector_dir.join("sample-input.json").display()
            );
            println!("  3. Run or restart the app to sync this source bundle into app-managed runtime assets");
        }
        Command::ConnectorTest { inputs_path, manifest_path, params_path } => {
            ensure_file_exists(&manifest_path, "connector manifest")?;
            let inputs = load_json_file(inputs_path.as_deref(), "inputs")
                .map_err(|error| -> MainError { Box::new(error) })?;
            let params = load_json_file(params_path.as_deref(), "params")
                .map_err(|error| -> MainError { Box::new(error) })?;
            let output = run_manifest_path(&manifest_path, inputs, params)
                .await
                .map_err(|error| -> MainError { Box::new(error) })?;
            println!("{}", serde_json::to_string_pretty(&output)?);
        }
        Command::List { json, workflows_dir } => {
            let workflows = load_workflows_from_dir(&workflows_dir)
                .map_err(|error| -> MainError { Box::new(error) })?;
            if json {
                let items = workflows
                    .into_iter()
                    .map(|workflow| {
                        json!({
                            "name": workflow.name,
                            "trigger_type": workflow.trigger.r#type,
                            "step_count": workflow.steps.len(),
                        })
                    })
                    .collect::<Vec<_>>();
                println!(
                    "{}",
                    serde_json::to_string_pretty(&json!({
                        "count": items.len(),
                        "workflows_dir": workflows_dir.display().to_string(),
                        "workflows": items,
                    }))?
                );
            } else {
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
        }
        Command::Run { database_path, json, max_concurrency, workflow_path } => {
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

            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&json!({
                        "completed_steps": summary.completed_steps,
                        "database_path": database_path.display().to_string(),
                        "outputs": summary.outputs,
                        "pending_tasks": summary.pending_tasks,
                        "run_id": summary.run_id,
                        "status": execution_status_name(summary.status),
                        "workflow_name": summary.workflow_name,
                    }))?
                );
            } else {
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
        Command::Validate { json, workflow_path } => {
            let workflow = load_workflow_from_path(&workflow_path)
                .map_err(|error| -> MainError { Box::new(error) })?;
            let plan =
                compile_workflow(workflow).map_err(|error| -> MainError { Box::new(error) })?;
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&json!({
                        "order": plan.order(),
                        "step_count": plan.workflow.steps.len(),
                        "trigger_type": plan.workflow.trigger.r#type,
                        "workflow_name": plan.workflow.name,
                        "workflow_path": workflow_path.display().to_string(),
                    }))?
                );
            } else {
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
        Command::Version => {
            println!("{}", version::release_string());
            println!("git={}", version::GIT_SHA);
        }
    }

    Ok(())
}

fn load_json_file(path: Option<&Path>, label: &str) -> Result<serde_json::Value, std::io::Error> {
    match path {
        Some(path) => {
            ensure_file_exists(path, label)?;
            let raw = fs::read_to_string(path)?;
            let parsed = serde_json::from_str(&raw).map_err(|error| {
                io::Error::other(format!(
                    "failed to parse {label} JSON from {}: {error}",
                    path.display()
                ))
            })?;
            Ok(parsed)
        }
        None => Ok(json!({})),
    }
}

fn ensure_file_exists(path: &Path, label: &str) -> Result<(), io::Error> {
    if path.exists() {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("{label} not found at {}", path.display()),
        ))
    }
}

fn parse_connector_runtime(runtime: &str) -> Result<ConnectorRuntime, MainError> {
    match runtime {
        "process" => Ok(ConnectorRuntime::Process),
        "wasm" => Ok(ConnectorRuntime::Wasm),
        other => Err(format!("unsupported connector runtime {other}").into()),
    }
}

fn report_error(error: &(dyn std::error::Error + 'static)) {
    eprintln!("error: {error}");
    if error.downcast_ref::<CliError>().is_some() {
        eprintln!();
        eprintln!("{}", Cli::usage());
    }
}

const fn runtime_name(runtime: ConnectorRuntime) -> &'static str {
    match runtime {
        ConnectorRuntime::Process => "process",
        ConnectorRuntime::Wasm => "wasm",
    }
}

const fn execution_status_name(status: acsa_core::engine::ExecutionStatus) -> &'static str {
    match status {
        acsa_core::engine::ExecutionStatus::Paused => "paused",
        acsa_core::engine::ExecutionStatus::Success => "success",
    }
}
