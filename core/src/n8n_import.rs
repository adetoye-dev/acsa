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

use std::collections::{BTreeMap, HashMap, HashSet};

use cron::Schedule;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::models::{Step, Trigger, Workflow};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct N8nImportResponse {
    pub workflow_id: String,
    pub workflow_name: String,
    pub yaml: String,
    pub report: TranslationReport,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct TranslationReport {
    pub translated: Vec<ReportItem>,
    pub degraded: Vec<ReportItem>,
    pub blocked: Vec<ReportItem>,
    pub requirements: Vec<RequirementItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReportItem {
    pub item_type: String,
    pub item_name: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RequirementItem {
    pub requirement_type: String,
    pub message: String,
}

pub fn translate_n8n_workflow(workflow_json: Value) -> Result<N8nImportResponse, String> {
    let workflow_object = workflow_json
        .as_object()
        .ok_or_else(|| "n8n workflow JSON must be an object".to_string())?;
    let raw_name = workflow_object.get("name").and_then(Value::as_str).map(str::trim).unwrap_or("");
    let workflow_name = if raw_name.is_empty() {
        "imported-n8n-workflow".to_string()
    } else {
        raw_name.to_string()
    };
    let mut workflow_id = slugify_workflow_name(&workflow_name);
    if workflow_id.is_empty() {
        workflow_id = "imported-n8n-workflow".to_string();
    }

    let mut report = TranslationReport::default();

    let nodes = workflow_object
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "n8n workflow JSON must include a nodes array".to_string())?;
    let connections = workflow_object.get("connections");

    let mut nodes_by_name = HashMap::new();
    for node in nodes {
        let Some(node_object) = node.as_object() else {
            continue;
        };
        let Some(name) = node_object.get("name").and_then(Value::as_str) else {
            continue;
        };
        let Some(node_type) = node_object.get("type").and_then(Value::as_str) else {
            continue;
        };
        let parameters = node_object.get("parameters").cloned().unwrap_or(Value::Null);
        nodes_by_name.insert(
            name.to_string(),
            N8nNode { name: name.to_string(), node_type: node_type.to_string(), parameters },
        );
    }

    let triggers = nodes_by_name
        .values()
        .filter(|node| is_supported_trigger_type(&node.node_type))
        .cloned()
        .collect::<Vec<_>>();
    if triggers.is_empty() {
        report.blocked.push(ReportItem {
            item_type: "workflow".to_string(),
            item_name: workflow_name.clone(),
            message: "no supported trigger found (manual, schedule, or webhook)".to_string(),
        });
        return Ok(N8nImportResponse { workflow_id, workflow_name, yaml: String::new(), report });
    }
    if triggers.len() > 1 {
        report.blocked.push(ReportItem {
            item_type: "workflow".to_string(),
            item_name: workflow_name.clone(),
            message: "multiple triggers detected; only single-trigger workflows are supported"
                .to_string(),
        });
        return Ok(N8nImportResponse { workflow_id, workflow_name, yaml: String::new(), report });
    }

    let trigger_node = triggers[0].clone();
    let mut blocked = Vec::new();
    for node in nodes_by_name.values() {
        if is_supported_trigger_type(&node.node_type) || node.node_type == HTTP_REQUEST_NODE_TYPE {
            continue;
        }
        blocked.push(ReportItem {
            item_type: "node".to_string(),
            item_name: node.name.clone(),
            message: format!("unsupported node type {}", node.node_type),
        });
    }
    if !blocked.is_empty() {
        report.blocked = blocked;
        return Ok(N8nImportResponse { workflow_id, workflow_name, yaml: String::new(), report });
    }

    let connection_map = build_connection_map(connections, &mut report);
    if !report.blocked.is_empty() {
        return Ok(N8nImportResponse { workflow_id, workflow_name, yaml: String::new(), report });
    }

    let chain = follow_chain(&trigger_node.name, &connection_map, &mut report);
    if !report.blocked.is_empty() {
        return Ok(N8nImportResponse { workflow_id, workflow_name, yaml: String::new(), report });
    }

    let mut steps = Vec::new();
    let mut step_ids = HashMap::new();
    let mut used_ids = HashSet::new();
    for node_name in chain.iter() {
        if node_name == &trigger_node.name {
            continue;
        }
        let node = match nodes_by_name.get(node_name) {
            Some(node) => node.clone(),
            None => {
                report.blocked.push(ReportItem {
                    item_type: "node".to_string(),
                    item_name: node_name.clone(),
                    message: "connection references missing node".to_string(),
                });
                continue;
            }
        };
        if node.node_type != HTTP_REQUEST_NODE_TYPE {
            report.blocked.push(ReportItem {
                item_type: "node".to_string(),
                item_name: node.name.clone(),
                message: format!(
                    "non-httpRequest node {} encountered in linear flow",
                    node.node_type
                ),
            });
            continue;
        }
        let step_id = unique_step_id(&node.name, &mut used_ids);
        step_ids.insert(node.name.clone(), step_id.clone());
        let (params, degradations, requirements) = map_http_request_params(&node);
        for degradation in degradations {
            report.degraded.push(ReportItem {
                item_type: "node".to_string(),
                item_name: node.name.clone(),
                message: degradation,
            });
        }
        for requirement in requirements {
            report.requirements.push(requirement);
        }
        if params.is_none() {
            report.blocked.push(ReportItem {
                item_type: "node".to_string(),
                item_name: node.name.clone(),
                message: "httpRequest node missing required method or url".to_string(),
            });
            continue;
        }
        let params = params.expect("params should exist");
        steps.push(Step {
            id: step_id,
            r#type: "http_request".to_string(),
            params,
            next: Vec::new(),
            retry: None,
            timeout_ms: None,
        });
        report.translated.push(ReportItem {
            item_type: "node".to_string(),
            item_name: node.name.clone(),
            message: "translated httpRequest node".to_string(),
        });
    }

    if !report.blocked.is_empty() {
        return Ok(N8nImportResponse { workflow_id, workflow_name, yaml: String::new(), report });
    }

    let mut trigger_details = BTreeMap::new();
    let trigger_type = match trigger_node.node_type.as_str() {
        MANUAL_TRIGGER_TYPE => "manual",
        CRON_TRIGGER_TYPE | SCHEDULE_TRIGGER_TYPE => "cron",
        WEBHOOK_TRIGGER_TYPE => "webhook",
        other => {
            report.blocked.push(ReportItem {
                item_type: "trigger".to_string(),
                item_name: trigger_node.name.clone(),
                message: format!("unsupported trigger type {other}"),
            });
            return Ok(N8nImportResponse {
                workflow_id,
                workflow_name,
                yaml: String::new(),
                report,
            });
        }
    };

    match trigger_type {
        "manual" => {
            report.translated.push(ReportItem {
                item_type: "trigger".to_string(),
                item_name: trigger_node.name.clone(),
                message: "translated manual trigger".to_string(),
            });
        }
        "cron" => match cron_schedule_from_node(&trigger_node) {
            Ok(schedule) => {
                trigger_details.insert("schedule".to_string(), serde_yaml::Value::String(schedule));
                report.translated.push(ReportItem {
                    item_type: "trigger".to_string(),
                    item_name: trigger_node.name.clone(),
                    message: "translated schedule trigger".to_string(),
                });
            }
            Err(message) => {
                report.blocked.push(ReportItem {
                    item_type: "trigger".to_string(),
                    item_name: trigger_node.name.clone(),
                    message,
                });
                return Ok(N8nImportResponse {
                    workflow_id,
                    workflow_name,
                    yaml: String::new(),
                    report,
                });
            }
        },
        "webhook" => match webhook_trigger_details(&trigger_node, &mut report) {
            Some(details) => {
                trigger_details = details;
                report.translated.push(ReportItem {
                    item_type: "trigger".to_string(),
                    item_name: trigger_node.name.clone(),
                    message: "translated webhook trigger".to_string(),
                });
            }
            None => {
                return Ok(N8nImportResponse {
                    workflow_id,
                    workflow_name,
                    yaml: String::new(),
                    report,
                });
            }
        },
        _ => {}
    }

    let mut step_index = HashMap::new();
    for (index, step) in steps.iter().enumerate() {
        step_index.insert(step.id.clone(), index);
    }
    for (position, node_name) in chain.iter().enumerate() {
        if node_name == &trigger_node.name {
            continue;
        }
        let Some(step_id) = step_ids.get(node_name) else {
            continue;
        };
        let Some(step_pos) = step_index.get(step_id).copied() else {
            continue;
        };
        let next_step_id = chain
            .get(position + 1)
            .and_then(|next_name| step_ids.get(next_name))
            .cloned()
            .map(|value| vec![value])
            .unwrap_or_default();
        steps[step_pos].next = next_step_id;
    }

    let workflow = Workflow {
        version: "v1".to_string(),
        name: workflow_name.clone(),
        trigger: Trigger { r#type: trigger_type.to_string(), details: trigger_details },
        steps,
        ui: Default::default(),
    };

    let yaml = serde_yaml::to_string(&workflow)
        .map_err(|error| format!("failed to serialize workflow: {error}"))?;

    Ok(N8nImportResponse { workflow_id, workflow_name, yaml, report })
}

#[derive(Debug, Clone)]
struct N8nNode {
    name: String,
    node_type: String,
    parameters: Value,
}

const MANUAL_TRIGGER_TYPE: &str = "n8n-nodes-base.manualTrigger";
const CRON_TRIGGER_TYPE: &str = "n8n-nodes-base.cron";
const SCHEDULE_TRIGGER_TYPE: &str = "n8n-nodes-base.scheduleTrigger";
const WEBHOOK_TRIGGER_TYPE: &str = "n8n-nodes-base.webhook";
const HTTP_REQUEST_NODE_TYPE: &str = "n8n-nodes-base.httpRequest";

fn is_supported_trigger_type(node_type: &str) -> bool {
    matches!(
        node_type,
        MANUAL_TRIGGER_TYPE | CRON_TRIGGER_TYPE | SCHEDULE_TRIGGER_TYPE | WEBHOOK_TRIGGER_TYPE
    )
}

fn cron_schedule_from_node(node: &N8nNode) -> Result<String, String> {
    let schedule = node
        .parameters
        .get("cronExpression")
        .or_else(|| node.parameters.get("expression"))
        .or_else(|| node.parameters.get("schedule"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "schedule trigger missing cron expression".to_string())?
        .to_string();

    schedule
        .parse::<Schedule>()
        .map_err(|error| format!("invalid cron expression {schedule}: {error}"))?;
    Ok(schedule)
}

fn webhook_trigger_details(
    node: &N8nNode,
    report: &mut TranslationReport,
) -> Option<BTreeMap<String, serde_yaml::Value>> {
    let mut details = BTreeMap::new();
    let path = node
        .parameters
        .get("path")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let path = match path {
        Some(path) => path,
        None => {
            report.blocked.push(ReportItem {
                item_type: "trigger".to_string(),
                item_name: node.name.clone(),
                message: "webhook trigger missing path".to_string(),
            });
            report.requirements.push(RequirementItem {
                requirement_type: "webhook_path".to_string(),
                message: "Provide a webhook path that Acsa can expose".to_string(),
            });
            return None;
        }
    };
    if path.starts_with('/') {
        details.insert("path".to_string(), serde_yaml::Value::String(path.to_string()));
    } else {
        details.insert("path".to_string(), serde_yaml::Value::String(format!("/{path}")));
        report.degraded.push(ReportItem {
            item_type: "trigger".to_string(),
            item_name: node.name.clone(),
            message: "webhook path missing leading slash; added".to_string(),
        });
    }

    let secret_env = read_string_param(&node.parameters, &["secretEnv", "secret_env"]);
    let token_env = read_string_param(&node.parameters, &["tokenEnv", "token_env"]);
    let signature_env = read_string_param(&node.parameters, &["signatureEnv", "signature_env"]);

    if secret_env.is_none() && token_env.is_none() && signature_env.is_none() {
        report.blocked.push(ReportItem {
            item_type: "trigger".to_string(),
            item_name: node.name.clone(),
            message: "webhook trigger missing authentication env configuration".to_string(),
        });
        report.requirements.push(RequirementItem {
            requirement_type: "webhook_auth".to_string(),
            message: "Provide secretEnv/tokenEnv/signatureEnv for webhook authentication"
                .to_string(),
        });
        return None;
    }

    if let Some(secret) = secret_env {
        details.insert("secret_env".to_string(), serde_yaml::Value::String(secret));
    }
    if let Some(token) = token_env {
        details.insert("token_env".to_string(), serde_yaml::Value::String(token));
    }
    if let Some(signature) = signature_env {
        details.insert("signature_env".to_string(), serde_yaml::Value::String(signature));
    }

    if let Some(header) = read_string_param(&node.parameters, &["signatureHeader"]) {
        details.insert("signature_header".to_string(), serde_yaml::Value::String(header));
    }
    if let Some(prefix) = read_string_param(&node.parameters, &["signaturePrefix"]) {
        details.insert("signature_prefix".to_string(), serde_yaml::Value::String(prefix));
    }

    Some(details)
}

fn read_string_param(parameters: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = parameters.get(*key).and_then(Value::as_str) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn build_connection_map(
    connections: Option<&Value>,
    report: &mut TranslationReport,
) -> HashMap<String, Vec<String>> {
    let mut map = HashMap::new();
    let Some(connections) = connections.and_then(Value::as_object) else {
        return map;
    };
    for (node_name, connection_value) in connections {
        let Some(main_outputs) = connection_value.get("main").and_then(Value::as_array) else {
            continue;
        };
        let mut downstream = Vec::new();
        for (index, output_value) in main_outputs.iter().enumerate() {
            let Some(output_array) = output_value.as_array() else {
                continue;
            };
            if index > 0 && !output_array.is_empty() {
                report.blocked.push(ReportItem {
                    item_type: "connection".to_string(),
                    item_name: node_name.to_string(),
                    message: "non-linear workflow: multiple outputs detected".to_string(),
                });
                return HashMap::new();
            }
            for connection in output_array {
                let Some(target) = connection.get("node").and_then(Value::as_str) else {
                    report.blocked.push(ReportItem {
                        item_type: "connection".to_string(),
                        item_name: node_name.to_string(),
                        message: "connection entry missing node reference".to_string(),
                    });
                    return HashMap::new();
                };
                downstream.push(target.to_string());
            }
        }
        if downstream.len() > 1 {
            report.blocked.push(ReportItem {
                item_type: "connection".to_string(),
                item_name: node_name.to_string(),
                message: "non-linear workflow: multiple downstream connections detected"
                    .to_string(),
            });
            return HashMap::new();
        }
        if !downstream.is_empty() {
            map.insert(node_name.to_string(), downstream);
        }
    }
    map
}

fn follow_chain(
    trigger_name: &str,
    connection_map: &HashMap<String, Vec<String>>,
    report: &mut TranslationReport,
) -> Vec<String> {
    let mut chain = Vec::new();
    let mut visited = HashSet::new();
    let mut current = trigger_name.to_string();
    chain.push(current.clone());
    visited.insert(current.clone());

    while let Some(next) = connection_map.get(&current).and_then(|targets| targets.first()) {
        if visited.contains(next) {
            report.blocked.push(ReportItem {
                item_type: "connection".to_string(),
                item_name: current.clone(),
                message: "non-linear workflow: cycle detected".to_string(),
            });
            return Vec::new();
        }
        chain.push(next.clone());
        visited.insert(next.clone());
        current = next.clone();
    }

    chain
}

fn map_http_request_params(
    node: &N8nNode,
) -> (Option<serde_yaml::Value>, Vec<String>, Vec<RequirementItem>) {
    let mut degradations = Vec::new();
    let mut requirements = Vec::new();
    let params = node.parameters.as_object().cloned().unwrap_or_default();
    let method = params
        .get("method")
        .or_else(|| params.get("httpMethod"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let url = params
        .get("url")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    if method.is_none() || url.is_none() {
        requirements.push(RequirementItem {
            requirement_type: "http_request".to_string(),
            message: format!("httpRequest node {} requires method and url parameters", node.name),
        });
        return (None, degradations, requirements);
    }

    let mut params_map = Map::new();
    params_map.insert("method".to_string(), Value::String(method.unwrap()));
    params_map.insert("url".to_string(), Value::String(url.unwrap()));

    let mut supported_keys = HashSet::new();
    supported_keys.insert("method");
    supported_keys.insert("httpMethod");
    supported_keys.insert("url");
    supported_keys.insert("headers");
    supported_keys.insert("query");
    supported_keys.insert("body");

    if let Some(headers) = params.get("headers") {
        if let Some(headers_object) = headers.as_object() {
            let mut filtered = Map::new();
            for (key, value) in headers_object {
                if looks_like_secret_key(key) && value.as_str().is_some() {
                    requirements.push(RequirementItem {
                        requirement_type: "header_secret".to_string(),
                        message: format!(
                            "header {key} in node {} should use headers_env or secret env",
                            node.name
                        ),
                    });
                    degradations
                        .push(format!("removed secret-like header {key} from {}", node.name));
                    continue;
                }
                filtered.insert(key.clone(), value.clone());
            }
            if !filtered.is_empty() {
                params_map.insert("headers".to_string(), Value::Object(filtered));
            }
        } else {
            degradations
                .push(format!("headers for node {} must be an object; ignoring", node.name));
        }
    }

    if let Some(query) = params.get("query") {
        params_map.insert("query".to_string(), query.clone());
    }

    if let Some(body) = params.get("body") {
        params_map.insert("body".to_string(), body.clone());
    }

    let unsupported_keys: Vec<String> =
        params.keys().filter(|key| !supported_keys.contains(key.as_str())).cloned().collect();
    if !unsupported_keys.is_empty() {
        degradations.push(format!(
            "ignored unsupported httpRequest parameters: {}",
            unsupported_keys.join(", ")
        ));
    }

    let yaml_params =
        serde_yaml::to_value(Value::Object(params_map)).unwrap_or(serde_yaml::Value::Null);

    (Some(yaml_params), degradations, requirements)
}

fn unique_step_id(name: &str, used_ids: &mut HashSet<String>) -> String {
    let base = slugify_workflow_name(name);
    let base = if base.is_empty() { "step".to_string() } else { base };
    if !used_ids.contains(&base) {
        used_ids.insert(base.clone());
        return base;
    }
    let mut counter = 2;
    loop {
        let candidate = format!("{base}-{counter}");
        if !used_ids.contains(&candidate) {
            used_ids.insert(candidate.clone());
            return candidate;
        }
        counter += 1;
    }
}

fn slugify_workflow_name(name: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;

    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash && !slug.is_empty() {
            slug.push('-');
            last_was_dash = true;
        }
    }

    slug.trim_matches('-').to_string().chars().collect::<String>()
}

fn looks_like_secret_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.contains("secret")
        || key.contains("token")
        || key.contains("password")
        || key.contains("credential")
        || key.contains("api_key")
        || key.contains("apikey")
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use serde_yaml::Value as YamlValue;

    use super::translate_n8n_workflow;

    #[test]
    fn translates_manual_trigger_with_linear_http_request() {
        let workflow_json = json!({
            "name": "Customer Intake",
            "nodes": [
                { "name": "Manual Trigger", "type": "n8n-nodes-base.manualTrigger", "parameters": {} },
                {
                    "name": "Fetch API",
                    "type": "n8n-nodes-base.httpRequest",
                    "parameters": { "method": "GET", "url": "https://example.com/health" }
                }
            ],
            "connections": {
                "Manual Trigger": {
                    "main": [[{ "node": "Fetch API", "type": "main", "index": 0 }]]
                }
            }
        });

        let response = translate_n8n_workflow(workflow_json).expect("translation should succeed");

        assert_eq!(response.workflow_name, "Customer Intake");
        assert_eq!(response.workflow_id, "customer-intake");
        assert!(!response.yaml.trim().is_empty());
        assert!(response.yaml.contains("type: manual"));
        assert!(response.yaml.contains("type: http_request"));
        assert!(response.report.blocked.is_empty());
        assert!(response.report.degraded.is_empty());
    }

    #[test]
    fn reports_unsupported_node_types() {
        let workflow_json = json!({
            "name": "Unsupported Nodes",
            "nodes": [
                { "name": "Manual Trigger", "type": "n8n-nodes-base.manualTrigger", "parameters": {} },
                { "name": "Send Email", "type": "n8n-nodes-base.emailSend", "parameters": {} }
            ],
            "connections": {
                "Manual Trigger": {
                    "main": [[{ "node": "Send Email", "type": "main", "index": 0 }]]
                }
            }
        });

        let response = translate_n8n_workflow(workflow_json).expect("translation should return");

        assert!(response.yaml.trim().is_empty());
        assert!(!response.report.blocked.is_empty());
        assert!(response.report.blocked[0].message.contains("unsupported node type"));
    }

    #[test]
    fn blocks_non_linear_branching() {
        let workflow_json = json!({
            "name": "Branching Flow",
            "nodes": [
                { "name": "Manual Trigger", "type": "n8n-nodes-base.manualTrigger", "parameters": {} },
                {
                    "name": "Fetch One",
                    "type": "n8n-nodes-base.httpRequest",
                    "parameters": { "method": "GET", "url": "https://example.com/one" }
                },
                {
                    "name": "Fetch Two",
                    "type": "n8n-nodes-base.httpRequest",
                    "parameters": { "method": "GET", "url": "https://example.com/two" }
                }
            ],
            "connections": {
                "Manual Trigger": {
                    "main": [[
                        { "node": "Fetch One", "type": "main", "index": 0 },
                        { "node": "Fetch Two", "type": "main", "index": 0 }
                    ]]
                }
            }
        });

        let response = translate_n8n_workflow(workflow_json).expect("translation should return");

        assert!(response.yaml.trim().is_empty());
        assert!(!response.report.blocked.is_empty());
        assert!(response.report.blocked[0].message.contains("non-linear"));
    }

    #[test]
    fn translates_schedule_trigger_with_cron_expression() {
        let workflow_json = json!({
            "name": "Scheduled Fetch",
            "nodes": [
                {
                    "name": "Cron",
                    "type": "n8n-nodes-base.cron",
                    "parameters": { "cronExpression": "0 */6 * * * *" }
                },
                {
                    "name": "Fetch API",
                    "type": "n8n-nodes-base.httpRequest",
                    "parameters": { "method": "GET", "url": "https://example.com/health" }
                }
            ],
            "connections": {
                "Cron": {
                    "main": [[{ "node": "Fetch API", "type": "main", "index": 0 }]]
                }
            }
        });

        let response = translate_n8n_workflow(workflow_json).expect("translation should succeed");
        let workflow_yaml: YamlValue =
            serde_yaml::from_str(&response.yaml).expect("workflow yaml should parse");

        assert!(response.yaml.contains("type: cron"));
        assert_eq!(
            workflow_yaml["trigger"]["schedule"],
            YamlValue::String("0 */6 * * * *".to_string())
        );
        assert!(response.report.blocked.is_empty());
    }

    #[test]
    fn translates_webhook_trigger_with_auth_and_path() {
        let workflow_json = json!({
            "name": "Inbound Webhook",
            "nodes": [
                {
                    "name": "Webhook",
                    "type": "n8n-nodes-base.webhook",
                    "parameters": {
                        "path": "/incoming",
                        "secretEnv": "ACSA_WEBHOOK_SECRET"
                    }
                },
                {
                    "name": "Fetch API",
                    "type": "n8n-nodes-base.httpRequest",
                    "parameters": { "method": "GET", "url": "https://example.com/health" }
                }
            ],
            "connections": {
                "Webhook": {
                    "main": [[{ "node": "Fetch API", "type": "main", "index": 0 }]]
                }
            }
        });

        let response = translate_n8n_workflow(workflow_json).expect("translation should succeed");

        assert!(response.yaml.contains("type: webhook"));
        assert!(response.yaml.contains("path: /incoming"));
        assert!(response.yaml.contains("secret_env: ACSA_WEBHOOK_SECRET"));
        assert!(response.report.blocked.is_empty());
    }

    #[test]
    fn blocks_webhook_without_required_auth() {
        let workflow_json = json!({
            "name": "Inbound Webhook",
            "nodes": [
                {
                    "name": "Webhook",
                    "type": "n8n-nodes-base.webhook",
                    "parameters": { "path": "/incoming" }
                }
            ],
            "connections": {}
        });

        let response = translate_n8n_workflow(workflow_json).expect("translation should return");

        assert!(response.yaml.trim().is_empty());
        assert!(!response.report.blocked.is_empty());
        assert!(response.report.blocked[0].message.contains("webhook"));
    }
}
