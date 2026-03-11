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

use std::{env, path::PathBuf};

use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cli {
    pub command: Command,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    ConnectorNew {
        connectors_dir: PathBuf,
        name: String,
        runtime: String,
        type_id: String,
    },
    ConnectorTest {
        inputs_path: Option<PathBuf>,
        manifest_path: PathBuf,
        params_path: Option<PathBuf>,
    },
    List {
        json: bool,
        workflows_dir: PathBuf,
    },
    Run {
        database_path: PathBuf,
        json: bool,
        max_concurrency: usize,
        workflow_path: PathBuf,
    },
    Serve {
        database_path: PathBuf,
        host: String,
        max_concurrency: usize,
        port: u16,
        workflows_dir: PathBuf,
    },
    Validate {
        json: bool,
        workflow_path: PathBuf,
    },
    Version,
}

impl Cli {
    pub fn from_env() -> Result<Self, CliError> {
        let args: Vec<String> = env::args().skip(1).collect();
        match args.as_slice() {
            [] => Ok(Self {
                command: Command::Validate {
                    json: false,
                    workflow_path: PathBuf::from("workflows/hello.yaml"),
                },
            }),
            [flag] if flag == "--help" || flag == "-h" => Err(CliError::HelpRequested),
            [flag] if flag == "--version" || flag == "-V" => Ok(Self { command: Command::Version }),
            [command, flag] if command == "help" && (flag == "--help" || flag == "-h") => {
                Err(CliError::HelpRequested)
            }
            [command] if command == "help" => Err(CliError::HelpRequested),
            [_, flag] if flag == "--help" || flag == "-h" => Err(CliError::HelpRequested),
            [command, rest @ ..] => match command.as_str() {
                "connector-new" => Ok(Self { command: parse_connector_new(rest)? }),
                "connector-test" => Ok(Self { command: parse_connector_test(rest)? }),
                "list" => Ok(Self { command: parse_list(rest)? }),
                "run" => Ok(Self { command: parse_run(rest)? }),
                "serve" => Ok(Self { command: parse_serve(rest)? }),
                "validate" => Ok(Self { command: parse_validate(rest)? }),
                "version" => Ok(Self { command: Command::Version }),
                other => Err(CliError::UnknownCommand { command: other.to_string() }),
            },
        }
    }

    pub const fn usage() -> &'static str {
        "Usage:\n  acsa-core validate [workflow-file] [--json]\n  acsa-core list [workflows-dir] [--json]\n  acsa-core run [workflow-file] [--db path] [--max-concurrency N] [--json]\n  acsa-core serve [workflows-dir] [--db path] [--host HOST] [--port PORT] [--max-concurrency N]\n  acsa-core connector-new NAME --type TYPE --runtime process|wasm [--dir connectors]\n  acsa-core connector-test [manifest-file] [--inputs path] [--params path]\n  acsa-core version\n  acsa-core --version\n\nDefaults:\n  validate        workflows/hello.yaml\n  list            workflows/\n  run             workflows/manual-demo.yaml --db acsa.db\n  serve           workflows/ --db acsa.db --host 127.0.0.1 --port 3001\n  connector-test  examples/process-connector/manifest.json --inputs examples/process-connector/sample-input.json\n\nExamples:\n  acsa-core run workflows/manual-demo.yaml --db acsa.db\n  acsa-core run workflows/manual-demo.yaml --db acsa.db --json\n  acsa-core list workflows --json\n  acsa-core serve workflows --db acsa.db --port 3001\n  acsa-core connector-test\n  acsa-core connector-new sample-echo --type sample_echo --runtime process --dir ./connectors"
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CliError {
    #[error("help requested")]
    HelpRequested,
    #[error("missing value for flag {flag}")]
    MissingFlagValue { flag: String },
    #[error("invalid numeric value {value} for flag {flag}")]
    InvalidNumber { flag: String, value: String },
    #[error("unknown command {command}")]
    UnknownCommand { command: String },
    #[error("unexpected argument {argument}")]
    UnexpectedArgument { argument: String },
}

fn parse_list(args: &[String]) -> Result<Command, CliError> {
    let mut workflows_dir = PathBuf::from("workflows");
    let mut json = false;
    let mut path_assigned = false;

    for argument in args {
        match argument.as_str() {
            "--json" => json = true,
            value => {
                if value.starts_with('-') {
                    return Err(CliError::UnexpectedArgument { argument: value.to_string() });
                }
                if path_assigned {
                    return Err(CliError::UnexpectedArgument { argument: value.to_string() });
                }
                workflows_dir = PathBuf::from(value);
                path_assigned = true;
            }
        }
    }

    Ok(Command::List { json, workflows_dir })
}

fn parse_run(args: &[String]) -> Result<Command, CliError> {
    let mut workflow_path = PathBuf::from("workflows/manual-demo.yaml");
    let mut database_path = PathBuf::from("acsa.db");
    let mut json = false;
    let mut max_concurrency = 4usize;
    let mut path_assigned = false;
    let mut index = 0usize;

    while index < args.len() {
        match args[index].as_str() {
            "--db" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| CliError::MissingFlagValue { flag: "--db".to_string() })?;
                database_path = PathBuf::from(value);
                index += 2;
            }
            "--max-concurrency" => {
                let value = args.get(index + 1).ok_or_else(|| CliError::MissingFlagValue {
                    flag: "--max-concurrency".to_string(),
                })?;
                max_concurrency = value.parse().map_err(|_| CliError::InvalidNumber {
                    flag: "--max-concurrency".to_string(),
                    value: value.clone(),
                })?;
                index += 2;
            }
            "--json" => {
                json = true;
                index += 1;
            }
            argument => {
                if path_assigned {
                    return Err(CliError::UnexpectedArgument { argument: argument.to_string() });
                }
                workflow_path = PathBuf::from(argument);
                path_assigned = true;
                index += 1;
            }
        }
    }

    Ok(Command::Run { database_path, json, max_concurrency, workflow_path })
}

fn parse_validate(args: &[String]) -> Result<Command, CliError> {
    let mut workflow_path = PathBuf::from("workflows/hello.yaml");
    let mut json = false;
    let mut path_assigned = false;

    for argument in args {
        match argument.as_str() {
            "--json" => json = true,
            value => {
                if path_assigned {
                    return Err(CliError::UnexpectedArgument { argument: value.to_string() });
                }
                workflow_path = PathBuf::from(value);
                path_assigned = true;
            }
        }
    }

    Ok(Command::Validate { json, workflow_path })
}

fn parse_connector_new(args: &[String]) -> Result<Command, CliError> {
    let mut connectors_dir = PathBuf::from("connectors");
    let mut name = None;
    let mut runtime = None;
    let mut type_id = None;
    let mut index = 0usize;

    while index < args.len() {
        match args[index].as_str() {
            "--dir" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| CliError::MissingFlagValue { flag: "--dir".to_string() })?;
                connectors_dir = PathBuf::from(value);
                index += 2;
            }
            "--runtime" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| CliError::MissingFlagValue { flag: "--runtime".to_string() })?;
                runtime = Some(value.clone());
                index += 2;
            }
            "--type" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| CliError::MissingFlagValue { flag: "--type".to_string() })?;
                type_id = Some(value.clone());
                index += 2;
            }
            argument => {
                if name.is_some() {
                    return Err(CliError::UnexpectedArgument { argument: argument.to_string() });
                }
                name = Some(argument.to_string());
                index += 1;
            }
        }
    }

    Ok(Command::ConnectorNew {
        connectors_dir,
        name: name.ok_or_else(|| CliError::MissingFlagValue { flag: "NAME".to_string() })?,
        runtime: runtime
            .ok_or_else(|| CliError::MissingFlagValue { flag: "--runtime".to_string() })?,
        type_id: type_id
            .ok_or_else(|| CliError::MissingFlagValue { flag: "--type".to_string() })?,
    })
}

fn parse_connector_test(args: &[String]) -> Result<Command, CliError> {
    let mut manifest_path = PathBuf::from("examples/process-connector/manifest.json");
    let mut inputs_path = None;
    let mut params_path = None;
    let mut path_assigned = false;
    let mut index = 0usize;

    while index < args.len() {
        match args[index].as_str() {
            "--inputs" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| CliError::MissingFlagValue { flag: "--inputs".to_string() })?;
                inputs_path = Some(PathBuf::from(value));
                index += 2;
            }
            "--params" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| CliError::MissingFlagValue { flag: "--params".to_string() })?;
                params_path = Some(PathBuf::from(value));
                index += 2;
            }
            argument => {
                if path_assigned {
                    return Err(CliError::UnexpectedArgument { argument: argument.to_string() });
                }
                manifest_path = PathBuf::from(argument);
                path_assigned = true;
                index += 1;
            }
        }
    }

    if !path_assigned && inputs_path.is_none() {
        inputs_path = Some(PathBuf::from("examples/process-connector/sample-input.json"));
    }

    Ok(Command::ConnectorTest { inputs_path, manifest_path, params_path })
}

fn parse_serve(args: &[String]) -> Result<Command, CliError> {
    let mut workflows_dir = PathBuf::from("workflows");
    let mut database_path = PathBuf::from("acsa.db");
    let mut host = "127.0.0.1".to_string();
    let mut port = 3001_u16;
    let mut max_concurrency = 4usize;
    let mut path_assigned = false;
    let mut index = 0usize;

    while index < args.len() {
        match args[index].as_str() {
            "--db" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| CliError::MissingFlagValue { flag: "--db".to_string() })?;
                database_path = PathBuf::from(value);
                index += 2;
            }
            "--host" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| CliError::MissingFlagValue { flag: "--host".to_string() })?;
                host = value.clone();
                index += 2;
            }
            "--port" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| CliError::MissingFlagValue { flag: "--port".to_string() })?;
                port = value.parse().map_err(|_| CliError::InvalidNumber {
                    flag: "--port".to_string(),
                    value: value.clone(),
                })?;
                index += 2;
            }
            "--max-concurrency" => {
                let value = args.get(index + 1).ok_or_else(|| CliError::MissingFlagValue {
                    flag: "--max-concurrency".to_string(),
                })?;
                max_concurrency = value.parse().map_err(|_| CliError::InvalidNumber {
                    flag: "--max-concurrency".to_string(),
                    value: value.clone(),
                })?;
                index += 2;
            }
            argument => {
                if path_assigned {
                    return Err(CliError::UnexpectedArgument { argument: argument.to_string() });
                }
                workflows_dir = PathBuf::from(argument);
                path_assigned = true;
                index += 1;
            }
        }
    }

    Ok(Command::Serve { database_path, host, max_concurrency, port, workflows_dir })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{parse_connector_test, Cli, Command};

    #[test]
    fn connector_test_defaults_to_the_working_example() {
        let command =
            parse_connector_test(&[]).expect("default connector test command should parse");

        assert_eq!(
            command,
            Command::ConnectorTest {
                manifest_path: PathBuf::from("examples/process-connector/manifest.json"),
                inputs_path: Some(PathBuf::from("examples/process-connector/sample-input.json")),
                params_path: None,
            }
        );
    }

    #[test]
    fn usage_lists_defaults_and_examples() {
        let usage = Cli::usage();

        assert!(usage.contains("Defaults:"));
        assert!(usage.contains("Examples:"));
        assert!(usage.contains("acsa-core connector-test"));
    }

    #[test]
    fn parse_list_accepts_json_flag() {
        let command = super::parse_list(&["workflows".to_string(), "--json".to_string()])
            .expect("list should parse");

        assert_eq!(
            command,
            Command::List { json: true, workflows_dir: PathBuf::from("workflows") }
        );
    }

    #[test]
    fn parse_run_accepts_json_flag() {
        let command = super::parse_run(&[
            "workflows/manual-demo.yaml".to_string(),
            "--db".to_string(),
            "acsa.db".to_string(),
            "--json".to_string(),
        ])
        .expect("run should parse");

        assert_eq!(
            command,
            Command::Run {
                database_path: PathBuf::from("acsa.db"),
                json: true,
                max_concurrency: 4,
                workflow_path: PathBuf::from("workflows/manual-demo.yaml"),
            }
        );
    }

    #[test]
    fn parse_validate_accepts_json_flag() {
        let command =
            super::parse_validate(&["--json".to_string()]).expect("validate should parse");

        assert_eq!(
            command,
            Command::Validate { json: true, workflow_path: PathBuf::from("workflows/hello.yaml") }
        );
    }
}
