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
    pub workflow_path: PathBuf,
}

impl Cli {
    pub fn from_env() -> Result<Self, CliError> {
        let args: Vec<_> = env::args_os().skip(1).collect();

        match args.as_slice() {
            [] => Ok(Self { workflow_path: PathBuf::from("workflows/hello.yaml") }),
            [arg] if arg.to_str() == Some("--help") || arg.to_str() == Some("-h") => {
                Err(CliError::HelpRequested)
            }
            [path] => Ok(Self { workflow_path: PathBuf::from(path) }),
            _ => Err(CliError::UnexpectedArguments { count: args.len() }),
        }
    }

    pub const fn usage() -> &'static str {
        "Usage: acsa-core [workflow-file]"
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CliError {
    #[error("help requested")]
    HelpRequested,
    #[error("expected at most one workflow file path, received {count} arguments")]
    UnexpectedArguments { count: usize },
}
