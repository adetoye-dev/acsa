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
#![allow(dead_code)]

use std::env;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StarterConnectorPack {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub source_dir: PathBuf,
    pub install_dir_name: &'static str,
    pub provided_step_types: &'static [&'static str],
}

#[cfg(test)]
pub const BUILD_TIME_MANIFEST_DIR: &str = env!("CARGO_MANIFEST_DIR");

/// Static metadata for starter connector packs (built at compile time).
#[derive(Debug, Clone, Copy)]
struct StarterConnectorPackMetadata {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    rel_path: &'static str,
    install_dir_name: &'static str,
    provided_step_types: &'static [&'static str],
}

#[derive(Debug, Error)]
pub enum StarterPackError {
    #[error("failed to resolve starter pack source path for {rel_path}: {message}")]
    SourcePathResolution { rel_path: String, message: String },
}

const PACK_METADATA: &[StarterConnectorPackMetadata] = &[
    StarterConnectorPackMetadata {
        id: "slack-notify",
        name: "Slack messages",
        description: "Send workflow messages to Slack channels and threads.",
        rel_path: "starter-packs/connectors/slack-notify",
        install_dir_name: "slack-notify",
        provided_step_types: &["slack_notify"],
    },
    StarterConnectorPackMetadata {
        id: "github-issue-create",
        name: "GitHub issues",
        description: "Create GitHub issues from workflows.",
        rel_path: "starter-packs/connectors/github-issue-create",
        install_dir_name: "github-issue-create",
        provided_step_types: &["github_issue_create"],
    },
    StarterConnectorPackMetadata {
        id: "google-sheets-append-row",
        name: "Google Sheets rows",
        description: "Add rows to Google Sheets from workflows.",
        rel_path: "starter-packs/connectors/google-sheets-append-row",
        install_dir_name: "google-sheets-append-row",
        provided_step_types: &["google_sheets_append_row"],
    },
    StarterConnectorPackMetadata {
        id: "email-send",
        name: "Email delivery",
        description: "Send workflow emails through your configured email provider.",
        rel_path: "starter-packs/connectors/email-send",
        install_dir_name: "email-send",
        provided_step_types: &["email_send"],
    },
];

/// Compute the source directory path for a starter pack at runtime.
/// First checks STARTER_PACKS_DIR environment variable, then falls back to
/// a path relative to the running executable.
fn compute_source_dir(rel_path: &str) -> Result<PathBuf, StarterPackError> {
    let rel = Path::new(rel_path);

    if let Ok(starter_packs_dir) = env::var("STARTER_PACKS_DIR") {
        let base = PathBuf::from(&starter_packs_dir);
        let mut candidates = vec![base.join(rel)];

        if base.ends_with(rel) {
            candidates.push(base.clone());
        }
        if let Ok(stripped) = rel.strip_prefix("starter-packs") {
            candidates.push(base.join(stripped));
        }
        if let Ok(stripped) = rel.strip_prefix("starter-packs/connectors") {
            candidates.push(base.join(stripped));
        }

        let mut seen = HashSet::new();
        candidates.retain(|candidate| seen.insert(candidate.clone()));
        if let Some(found) = candidates.into_iter().find(|candidate| candidate.exists()) {
            return Ok(found);
        }

        return Err(StarterPackError::SourcePathResolution {
            rel_path: rel_path.to_string(),
            message: format!(
                "STARTER_PACKS_DIR='{starter_packs_dir}' did not resolve to an existing starter pack path; set STARTER_PACKS_DIR to a valid repo root, starter-packs directory, connectors directory, or pack directory"
            ),
        });
    }

    match env::current_exe() {
        Ok(exe_path) => {
            if let Some(exe_dir) = exe_path.parent() {
                let mut candidates = vec![exe_dir.join(rel)];
                if let Some(parent) = exe_dir.parent() {
                    candidates.push(parent.join(rel));
                }
                if let Some(grandparent) = exe_dir.parent().and_then(Path::parent) {
                    candidates.push(grandparent.join(rel));
                }

                for base in platform_shared_data_dirs() {
                    candidates.push(base.join(rel));
                }

                let mut seen = HashSet::new();
                candidates.retain(|candidate| seen.insert(candidate.clone()));
                if let Some(found) = candidates.into_iter().find(|candidate| candidate.exists()) {
                    return Ok(found);
                }
            }
            Err(StarterPackError::SourcePathResolution {
                rel_path: rel_path.to_string(),
                message: format!(
                    "could not resolve starter pack path from current_exe='{}'; set STARTER_PACKS_DIR",
                    exe_path.display()
                ),
            })
        }
        Err(error) => {
            tracing::error!(
                rel_path,
                error = %error,
                "failed to resolve starter pack path via current_exe"
            );
            #[cfg(test)]
            {
                tracing::warn!(
                    rel_path,
                    "using build-time manifest directory fallback for tests after current_exe failure"
                );
                Ok(PathBuf::from(BUILD_TIME_MANIFEST_DIR).join("..").join(rel_path))
            }

            #[cfg(not(test))]
            {
                Err(StarterPackError::SourcePathResolution {
                    rel_path: rel_path.to_string(),
                    message: format!("current_exe() failed: {error}"),
                })
            }
        }
    }
}

#[cfg(unix)]
fn platform_shared_data_dirs() -> Vec<PathBuf> {
    vec![
        PathBuf::from("/usr/local/share/acsa"),
        PathBuf::from("/opt/homebrew/share/acsa"),
    ]
}

#[cfg(windows)]
fn platform_shared_data_dirs() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(program_data) = env::var("ProgramData") {
        candidates.push(PathBuf::from(program_data).join("acsa"));
    }
    candidates
}

#[cfg(not(any(unix, windows)))]
fn platform_shared_data_dirs() -> Vec<PathBuf> {
    Vec::new()
}

fn starter_connector_pack_from_metadata(
    meta: &StarterConnectorPackMetadata,
) -> Result<StarterConnectorPack, StarterPackError> {
    Ok(StarterConnectorPack {
        id: meta.id,
        name: meta.name,
        description: meta.description,
        source_dir: compute_source_dir(meta.rel_path)?,
        install_dir_name: meta.install_dir_name,
        provided_step_types: meta.provided_step_types,
    })
}

pub fn starter_connector_packs() -> Result<Vec<StarterConnectorPack>, StarterPackError> {
    PACK_METADATA.iter().map(starter_connector_pack_from_metadata).collect()
}

pub fn starter_connector_pack(id: &str) -> Result<Option<StarterConnectorPack>, StarterPackError> {
    let Some(meta) = PACK_METADATA.iter().find(|meta| meta.id == id) else {
        return Ok(None);
    };

    starter_connector_pack_from_metadata(meta).map(Some)
}

#[cfg(test)]
mod tests {
    use super::starter_connector_packs;

    #[test]
    fn starter_connector_pack_catalog_uses_capability_first_copy() {
        let catalog = starter_connector_packs().expect("starter pack catalog should resolve source directories");
        let by_id = |id: &str| {
            catalog.iter().find(|pack| pack.id == id).expect("starter pack should exist")
        };

        let slack = by_id("slack-notify");
        assert_eq!(slack.name, "Slack messages");
        assert_eq!(slack.description, "Send workflow messages to Slack channels and threads.");

        let github = by_id("github-issue-create");
        assert_eq!(github.name, "GitHub issues");
        assert_eq!(github.description, "Create GitHub issues from workflows.");

        let sheets = by_id("google-sheets-append-row");
        assert_eq!(sheets.name, "Google Sheets rows");
        assert_eq!(sheets.description, "Add rows to Google Sheets from workflows.");

        let email = by_id("email-send");
        assert_eq!(email.name, "Email delivery");
        assert_eq!(
            email.description,
            "Send workflow emails through your configured email provider."
        );
    }
}
