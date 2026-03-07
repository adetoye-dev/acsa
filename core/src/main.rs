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

use acsa_core::{cli::Cli, engine};

type MainError = Box<dyn std::error::Error>;

#[tokio::main]
async fn main() -> Result<(), MainError> {
    let cli = match Cli::from_env() {
        Ok(cli) => cli,
        Err(acsa_core::cli::CliError::HelpRequested) => {
            println!("{}", Cli::usage());
            return Ok(());
        }
        Err(error) => return Err(error.into()),
    };

    let workflow = engine::load_workflow_from_path(&cli.workflow_path)
        .map_err(|error| -> MainError { Box::new(error) })?;

    println!(
        "Loaded workflow '{}' (trigger: {}, steps: {}) from {}",
        workflow.name,
        workflow.trigger.r#type,
        workflow.steps.len(),
        cli.workflow_path.display()
    );

    Ok(())
}
