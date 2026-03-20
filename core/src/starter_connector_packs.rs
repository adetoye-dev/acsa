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
        name: "Slack messages",
        description: "Send workflow messages to Slack channels and threads.",
        source_dir: concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../starter-packs/connectors/slack-notify"
        ),
        install_dir_name: "slack-notify",
        provided_step_types: &["slack_notify"],
    },
    StarterConnectorPack {
        id: "github-issue-create",
        name: "GitHub issues",
        description: "Create GitHub issues from workflows.",
        source_dir: concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../starter-packs/connectors/github-issue-create"
        ),
        install_dir_name: "github-issue-create",
        provided_step_types: &["github_issue_create"],
    },
    StarterConnectorPack {
        id: "google-sheets-append-row",
        name: "Google Sheets rows",
        description: "Add rows to Google Sheets from workflows.",
        source_dir: concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../starter-packs/connectors/google-sheets-append-row"
        ),
        install_dir_name: "google-sheets-append-row",
        provided_step_types: &["google_sheets_append_row"],
    },
    StarterConnectorPack {
        id: "email-send",
        name: "Email delivery",
        description: "Send workflow emails through your configured email provider.",
        source_dir: concat!(env!("CARGO_MANIFEST_DIR"), "/../starter-packs/connectors/email-send"),
        install_dir_name: "email-send",
        provided_step_types: &["email_send"],
    },
];

pub fn starter_connector_packs() -> &'static [StarterConnectorPack] {
    STARTER_CONNECTOR_PACKS
}

pub fn starter_connector_pack(id: &str) -> Option<&'static StarterConnectorPack> {
    STARTER_CONNECTOR_PACKS.iter().find(|pack| pack.id == id)
}

#[cfg(test)]
mod tests {
    use super::starter_connector_packs;

    #[test]
    fn starter_connector_pack_catalog_uses_capability_first_copy() {
        let catalog = starter_connector_packs();
        let by_id = |id: &str| {
            catalog
                .iter()
                .find(|pack| pack.id == id)
                .expect("starter pack should exist")
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
