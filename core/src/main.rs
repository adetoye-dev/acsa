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

use serde_json::json;

use acsa_core::{
    cli::{Cli, CliError, Command},
    engine::{
        compile_workflow, load_workflow_from_path, load_workflows_from_dir, ExecutionConfig,
        WorkflowEngine,
    },
};

type MainError = Box<dyn std::error::Error>;

#[tokio::main]
async fn main() -> Result<(), MainError> {
    let cli = match Cli::from_env() {
        Ok(cli) => cli,
        Err(CliError::HelpRequested) => {
            println!("{}", Cli::usage());
            return Ok(());
        }
        Err(error) => return Err(error.into()),
    };

    match cli.command {
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

            println!(
                "Run {} completed for '{}' with {} step(s)",
                summary.run_id, summary.workflow_name, summary.completed_steps
            );
            println!("SQLite state written to {}", database_path.display());
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
