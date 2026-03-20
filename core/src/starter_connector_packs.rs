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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StarterConnectorPack {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub source_dir: &'static str,
    pub install_dir_name: &'static str,
    pub provided_step_types: &'static [&'static str],
}

pub const STARTER_CONNECTOR_PACKS: &[StarterConnectorPack] = &[
    StarterConnectorPack {
        id: "slack-notify",
        name: "Slack Notify",
        description: "Send a workflow-generated message to Slack.",
        source_dir: concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../starter-packs/connectors/slack-notify"
        ),
        install_dir_name: "slack-notify",
        provided_step_types: &["slack.notify"],
    },
    StarterConnectorPack {
        id: "github-issue-create",
        name: "GitHub Issue Create",
        description: "Create a representative GitHub issue payload.",
        source_dir: concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../starter-packs/connectors/github-issue-create"
        ),
        install_dir_name: "github-issue-create",
        provided_step_types: &["github.issue.create"],
    },
    StarterConnectorPack {
        id: "google-sheets-append-row",
        name: "Google Sheets Append Row",
        description: "Append a representative row into Google Sheets.",
        source_dir: concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../starter-packs/connectors/google-sheets-append-row"
        ),
        install_dir_name: "google-sheets-append-row",
        provided_step_types: &["google.sheets.append_row"],
    },
    StarterConnectorPack {
        id: "email-send",
        name: "Email Send",
        description: "Send a representative email payload.",
        source_dir: concat!(env!("CARGO_MANIFEST_DIR"), "/../starter-packs/connectors/email-send"),
        install_dir_name: "email-send",
        provided_step_types: &["email.send"],
    },
];

pub fn starter_connector_packs() -> &'static [StarterConnectorPack] {
    STARTER_CONNECTOR_PACKS
}

pub fn starter_connector_pack(id: &str) -> Option<&'static StarterConnectorPack> {
    STARTER_CONNECTOR_PACKS.iter().find(|pack| pack.id == id)
}
