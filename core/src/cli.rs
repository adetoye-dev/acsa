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
    List {
        workflows_dir: PathBuf,
    },
    Run {
        database_path: PathBuf,
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
        workflow_path: PathBuf,
    },
}

impl Cli {
    pub fn from_env() -> Result<Self, CliError> {
        let args: Vec<String> = env::args().skip(1).collect();
        match args.as_slice() {
            [] => Ok(Self {
                command: Command::Validate { workflow_path: PathBuf::from("workflows/hello.yaml") },
            }),
            [flag] if flag == "--help" || flag == "-h" => Err(CliError::HelpRequested),
            [command, rest @ ..] => match command.as_str() {
                "list" => Ok(Self { command: parse_list(rest)? }),
                "run" => Ok(Self { command: parse_run(rest)? }),
                "serve" => Ok(Self { command: parse_serve(rest)? }),
                "validate" => Ok(Self { command: parse_validate(rest)? }),
                other => Err(CliError::UnknownCommand { command: other.to_string() }),
            },
        }
    }

    pub const fn usage() -> &'static str {
        "Usage:\n  acsa-core validate [workflow-file]\n  acsa-core list [workflows-dir]\n  acsa-core run [workflow-file] [--db path] [--max-concurrency N]\n  acsa-core serve [workflows-dir] [--db path] [--host HOST] [--port PORT] [--max-concurrency N]"
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
    match args {
        [] => Ok(Command::List { workflows_dir: PathBuf::from("workflows") }),
        [path] => Ok(Command::List { workflows_dir: PathBuf::from(path) }),
        [unexpected, ..] => Err(CliError::UnexpectedArgument { argument: unexpected.clone() }),
    }
}

fn parse_run(args: &[String]) -> Result<Command, CliError> {
    let mut workflow_path = PathBuf::from("workflows/manual-demo.yaml");
    let mut database_path = PathBuf::from("acsa.db");
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

    Ok(Command::Run { database_path, max_concurrency, workflow_path })
}

fn parse_validate(args: &[String]) -> Result<Command, CliError> {
    match args {
        [] => Ok(Command::Validate { workflow_path: PathBuf::from("workflows/hello.yaml") }),
        [path] => Ok(Command::Validate { workflow_path: PathBuf::from(path) }),
        [unexpected, ..] => Err(CliError::UnexpectedArgument { argument: unexpected.clone() }),
    }
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
