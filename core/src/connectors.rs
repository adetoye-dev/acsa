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

use std::{
    collections::BTreeMap,
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
};

use async_trait::async_trait;
use extism::{Manifest as ExtismManifest, PluginBuilder, Wasm};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use shlex::split as shlex_split;
use thiserror::Error;
use tokio::{io::AsyncWriteExt, process::Command, time::timeout};

use crate::nodes::{ensure_relative_path, Node, NodeError, NodeRegistry};

const DEFAULT_CONNECTOR_TIMEOUT_MS: u64 = 10_000;
const MAX_CONNECTOR_TIMEOUT_MS: u64 = 5 * 60_000;
const MAX_CONNECTOR_PAYLOAD_BYTES: usize = 1024 * 1024;
const MAX_CONNECTOR_OUTPUT_BYTES: usize = 1024 * 1024;
const MAX_WASM_MEMORY_MB: u64 = 256;
const WASM_CONNECTOR_RUNTIME_ENV: &str = "ACSA_ENABLE_WASM_CONNECTORS";
const PROCESS_LAUNCHERS: &[&str] = &["sh", "bash", "python", "python3", "node", "deno"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorManifest {
    #[serde(default)]
    pub allowed_env: Vec<String>,
    #[serde(default)]
    pub allowed_hosts: Vec<String>,
    #[serde(default)]
    pub allowed_paths: BTreeMap<String, String>,
    pub entry: String,
    #[serde(default)]
    pub enable_wasi: bool,
    #[serde(default)]
    pub inputs: Vec<String>,
    #[serde(default)]
    pub limits: ConnectorLimits,
    pub name: String,
    #[serde(default)]
    pub outputs: Vec<String>,
    pub runtime: ConnectorRuntime,
    #[serde(rename = "type")]
    pub type_id: String,
    #[serde(default)]
    pub version: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ConnectorLimits {
    #[serde(default)]
    pub memory: Option<u64>,
    #[serde(default)]
    pub timeout: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorRuntime {
    Process,
    Wasm,
}

#[derive(Clone)]
struct ConnectorNode {
    connector_dir: PathBuf,
    manifest: ConnectorManifest,
}

#[async_trait]
impl Node for ConnectorNode {
    fn type_name(&self) -> &str {
        &self.manifest.type_id
    }

    async fn execute(&self, inputs: &Value, params: &Value) -> Result<Value, NodeError> {
        validate_required_inputs(&self.manifest, inputs)?;
        let secrets = resolve_secrets(params)?;
        let payload = json!({
            "inputs": inputs,
            "params": params,
            "secrets": secrets
        });
        let payload_bytes = serialize_connector_json(
            &self.manifest.type_id,
            "input payload",
            &payload,
            MAX_CONNECTOR_PAYLOAD_BYTES,
        )
        .map_err(connector_error)?;

        let output = match self.manifest.runtime {
            ConnectorRuntime::Process => {
                execute_process_connector(&self.connector_dir, &self.manifest, &payload_bytes)
                    .await
                    .map_err(connector_error)?
            }
            ConnectorRuntime::Wasm => {
                execute_wasm_connector(&self.connector_dir, &self.manifest, &payload_bytes)
                    .await
                    .map_err(connector_error)?
            }
        };

        validate_output_keys(&self.manifest, &output)?;
        Ok(output)
    }
}

pub fn load_connectors_into(
    registry: &NodeRegistry,
    connectors_dir: &Path,
) -> Result<Vec<String>, ConnectorError> {
    let mut loaded = Vec::new();

    for (connector_dir, manifest) in discover_connectors(connectors_dir)? {
        let type_id = manifest.type_id.clone();
        registry.register(ConnectorNode { connector_dir, manifest });
        loaded.push(type_id);
    }

    Ok(loaded)
}

pub fn discover_connector_manifests(
    connectors_dir: &Path,
) -> Result<Vec<ConnectorManifest>, ConnectorError> {
    discover_connectors(connectors_dir)
        .map(|connectors| connectors.into_iter().map(|(_, manifest)| manifest).collect())
}

pub fn load_manifest(path: &Path) -> Result<ConnectorManifest, ConnectorError> {
    let raw = fs::read_to_string(path)?;
    let manifest = serde_json::from_str::<ConnectorManifest>(&raw)?;
    Ok(manifest)
}

pub async fn run_manifest_path(
    manifest_path: &Path,
    inputs: Value,
    params: Value,
) -> Result<Value, ConnectorError> {
    let manifest = load_manifest(manifest_path)?;
    let connector_dir = fs::canonicalize(manifest_path.parent().ok_or_else(|| {
        ConnectorError::InvalidManifest {
            message: format!("manifest path {} has no parent directory", manifest_path.display()),
        }
    })?)?;
    validate_manifest(&manifest, &connector_dir)?;
    let node = ConnectorNode { connector_dir: connector_dir.to_path_buf(), manifest };
    node.execute(&inputs, &params)
        .await
        .map_err(|error| ConnectorError::ExecutionFailed { details: error.to_string() })
}

pub fn scaffold_connector(
    connectors_dir: &Path,
    name: &str,
    type_id: &str,
    runtime: ConnectorRuntime,
) -> Result<PathBuf, ConnectorError> {
    if name.trim().is_empty() || type_id.trim().is_empty() {
        return Err(ConnectorError::InvalidManifest {
            message: "connector name and type must be non-empty".to_string(),
        });
    }
    let connector_dir = connectors_dir.join(name);
    fs::create_dir_all(&connector_dir)?;
    match runtime {
        ConnectorRuntime::Process => scaffold_process_connector(&connector_dir, name, type_id)?,
        ConnectorRuntime::Wasm => scaffold_wasm_connector(&connector_dir, name, type_id)?,
    }
    Ok(connector_dir)
}

async fn execute_process_connector(
    connector_dir: &Path,
    manifest: &ConnectorManifest,
    payload_bytes: &[u8],
) -> Result<Value, ConnectorError> {
    let command = resolve_process_command(connector_dir, &manifest.entry)?;
    let mut process = Command::new(&command[0]);
    process.args(&command[1..]);
    process.current_dir(connector_dir);
    process.kill_on_drop(true);
    process.env_clear();
    if let Some(path) = std::env::var_os("PATH") {
        process.env("PATH", path);
    }
    for env_name in &manifest.allowed_env {
        if let Ok(value) = std::env::var(env_name) {
            process.env(env_name, value);
        }
    }
    process.stdin(std::process::Stdio::piped());
    process.stdout(std::process::Stdio::piped());
    process.stderr(std::process::Stdio::piped());

    let mut child = process.spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(payload_bytes).await?;
        drop(stdin); // Close stdin to send EOF to child
    }
    let wait_future = child.wait_with_output();
    let output = match timeout(connector_timeout(manifest), wait_future).await {
        Ok(result) => result?,
        Err(_) => {
            return Err(ConnectorError::Timeout {
                connector_type: manifest.type_id.clone(),
                timeout_ms: timeout_ms(manifest),
            });
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(ConnectorError::ProcessFailed {
            connector_type: manifest.type_id.clone(),
            message: stderr,
        });
    }

    if output.stdout.len() > MAX_CONNECTOR_OUTPUT_BYTES {
        return Err(ConnectorError::OutputTooLarge {
            connector_type: manifest.type_id.clone(),
            size: output.stdout.len(),
            limit: MAX_CONNECTOR_OUTPUT_BYTES,
        });
    }

    parse_connector_output(&manifest.type_id, &output.stdout)
}

async fn execute_wasm_connector(
    connector_dir: &Path,
    manifest: &ConnectorManifest,
    payload_bytes: &[u8],
) -> Result<Value, ConnectorError> {
    if !wasm_runtime_enabled() {
        return Err(ConnectorError::RuntimeDisabled {
            connector_type: manifest.type_id.clone(),
            message: format!(
                "wasm connectors are disabled by default; set {WASM_CONNECTOR_RUNTIME_ENV}=1 to enable them explicitly"
            ),
        });
    }
    let wasm_path = ensure_relative_path(connector_dir, &manifest.entry)
        .map_err(|error| ConnectorError::InvalidManifest { message: error.to_string() })?;
    let mut extism_manifest = ExtismManifest::new([Wasm::file(&wasm_path)]);
    extism_manifest =
        extism_manifest.with_allowed_hosts(manifest.allowed_hosts.clone().into_iter());
    extism_manifest =
        extism_manifest.with_memory_max(memory_pages(manifest.limits.memory.unwrap_or_default())?);
    extism_manifest =
        extism_manifest.with_timeout(std::time::Duration::from_millis(timeout_ms(manifest)));
    let allowed_paths = resolve_allowed_wasi_paths(connector_dir, manifest)?;
    if !allowed_paths.is_empty() {
        extism_manifest = extism_manifest.with_allowed_paths(allowed_paths.into_iter());
    }

    let mut plugin = PluginBuilder::new(extism_manifest)
        .with_wasi(manifest.enable_wasi)
        .build()
        .map_err(|error| ConnectorError::WasmRuntime {
            connector_type: manifest.type_id.clone(),
            message: error.to_string(),
        })?;
    let input =
        std::str::from_utf8(payload_bytes).map_err(|error| ConnectorError::InvalidUtf8 {
            connector_type: manifest.type_id.clone(),
            message: error.to_string(),
        })?;
    let output = plugin.call::<&str, String>("execute", input).map_err(|error| {
        ConnectorError::WasmRuntime {
            connector_type: manifest.type_id.clone(),
            message: error.to_string(),
        }
    })?;
    if output.len() > MAX_CONNECTOR_OUTPUT_BYTES {
        return Err(ConnectorError::OutputTooLarge {
            connector_type: manifest.type_id.clone(),
            size: output.len(),
            limit: MAX_CONNECTOR_OUTPUT_BYTES,
        });
    }
    serde_json::from_str::<Value>(&output).map_err(ConnectorError::from)
}

fn connector_error(error: ConnectorError) -> NodeError {
    NodeError::Message { message: error.to_string() }
}

fn connector_timeout(manifest: &ConnectorManifest) -> std::time::Duration {
    std::time::Duration::from_millis(timeout_ms(manifest))
}

fn discover_connectors(
    connectors_dir: &Path,
) -> Result<Vec<(PathBuf, ConnectorManifest)>, ConnectorError> {
    if !connectors_dir.exists() {
        return Ok(Vec::new());
    }

    let mut discovered = Vec::new();
    let mut entries = fs::read_dir(connectors_dir)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.path());

    for entry in entries {
        let connector_dir = fs::canonicalize(entry.path())?;
        if !connector_dir.is_dir() {
            continue;
        }
        let manifest_path = connector_dir.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }

        let manifest = load_manifest(&manifest_path)?;
        validate_manifest(&manifest, &connector_dir)?;
        discovered.push((connector_dir, manifest));
    }

    Ok(discovered)
}

fn load_process_argument(connector_dir: &Path, argument: &str) -> OsString {
    let candidate = connector_dir.join(argument);
    if !Path::new(argument).is_absolute() && candidate.exists() {
        // Prevent path traversal by verifying candidate is within connector_dir
        if let (Ok(canonical_dir), Ok(canonical_candidate)) =
            (fs::canonicalize(connector_dir), fs::canonicalize(&candidate))
        {
            if canonical_candidate.starts_with(&canonical_dir) {
                return candidate.into_os_string();
            }
        }
    }
    OsString::from(argument)
}

fn memory_pages(memory_mb: u64) -> Result<u32, ConnectorError> {
    if memory_mb == 0 {
        return Err(ConnectorError::InvalidManifest {
            message: "wasm connector memory limit must be greater than zero".to_string(),
        });
    }
    let bytes = memory_mb.checked_mul(1024 * 1024).ok_or_else(|| {
        ConnectorError::InvalidManifest { message: "memory limit overflows u64".to_string() }
    })?;
    let pages = bytes / 65_536;
    u32::try_from(pages).map_err(|_| ConnectorError::InvalidManifest {
        message: "memory limit is too large for extism".to_string(),
    })
}

fn parse_connector_output(connector_type: &str, bytes: &[u8]) -> Result<Value, ConnectorError> {
    let text = std::str::from_utf8(bytes).map_err(|error| ConnectorError::InvalidUtf8 {
        connector_type: connector_type.to_string(),
        message: error.to_string(),
    })?;
    serde_json::from_str::<Value>(text).map_err(ConnectorError::from)
}

fn resolve_allowed_wasi_paths(
    connector_dir: &Path,
    manifest: &ConnectorManifest,
) -> Result<Vec<(String, PathBuf)>, ConnectorError> {
    let mut resolved = Vec::new();
    for (guest_path, host_path) in &manifest.allowed_paths {
        if guest_path.trim().is_empty() {
            return Err(ConnectorError::InvalidManifest {
                message: "allowed_paths guest path must not be empty".to_string(),
            });
        }
        let host = ensure_relative_path(connector_dir, host_path)
            .map_err(|error| ConnectorError::InvalidManifest { message: error.to_string() })?;
        resolved.push((guest_path.clone(), host));
    }
    Ok(resolved)
}

fn resolve_process_command(
    connector_dir: &Path,
    entry: &str,
) -> Result<Vec<OsString>, ConnectorError> {
    let parts = shlex_split(entry).ok_or_else(|| ConnectorError::InvalidManifest {
        message: format!("connector entry {entry} could not be parsed"),
    })?;
    if parts.is_empty() {
        return Err(ConnectorError::InvalidManifest {
            message: "connector entry must not be empty".to_string(),
        });
    }

    Ok(parts.iter().map(|argument| load_process_argument(connector_dir, argument)).collect())
}

fn serialize_connector_json(
    connector_type: &str,
    context: &str,
    value: &Value,
    limit: usize,
) -> Result<Vec<u8>, ConnectorError> {
    let bytes = serde_json::to_vec(value)?;
    if bytes.len() > limit {
        return Err(ConnectorError::PayloadTooLarge {
            connector_type: connector_type.to_string(),
            context: context.to_string(),
            size: bytes.len(),
            limit,
        });
    }
    Ok(bytes)
}

fn scaffold_process_connector(
    connector_dir: &Path,
    name: &str,
    type_id: &str,
) -> Result<(), ConnectorError> {
    let manifest = ConnectorManifest {
        allowed_env: Vec::new(),
        allowed_hosts: Vec::new(),
        allowed_paths: BTreeMap::new(),
        entry: "python3 main.py".to_string(),
        enable_wasi: false,
        inputs: vec!["message".to_string()],
        limits: ConnectorLimits { memory: None, timeout: Some(10_000) },
        name: name.to_string(),
        outputs: vec!["echoed".to_string()],
        runtime: ConnectorRuntime::Process,
        type_id: type_id.to_string(),
        version: Some("0.1.0".to_string()),
    };
    fs::write(connector_dir.join("manifest.json"), serde_json::to_string_pretty(&manifest)?)?;
    fs::write(
        connector_dir.join("main.py"),
        r#"#!/usr/bin/env python3
import json
import sys

payload = json.load(sys.stdin)
message = payload.get("inputs", {}).get("message", "")
print(json.dumps({"echoed": message, "params": payload.get("params", {})}))
"#,
    )?;
    scaffold_sample_files(connector_dir, name, type_id, ConnectorRuntime::Process)?;
    Ok(())
}

fn scaffold_wasm_connector(
    connector_dir: &Path,
    name: &str,
    type_id: &str,
) -> Result<(), ConnectorError> {
    let manifest = ConnectorManifest {
        allowed_env: Vec::new(),
        allowed_hosts: Vec::new(),
        allowed_paths: BTreeMap::new(),
        entry: "dist/connector.wasm".to_string(),
        enable_wasi: false,
        inputs: vec!["message".to_string()],
        limits: ConnectorLimits { memory: Some(64), timeout: Some(10_000) },
        name: name.to_string(),
        outputs: vec!["echoed".to_string()],
        runtime: ConnectorRuntime::Wasm,
        type_id: type_id.to_string(),
        version: Some("0.1.0".to_string()),
    };
    fs::create_dir_all(connector_dir.join("src"))?;
    fs::create_dir_all(connector_dir.join("dist"))?;
    fs::write(connector_dir.join("manifest.json"), serde_json::to_string_pretty(&manifest)?)?;
    fs::write(
        connector_dir.join("Cargo.toml"),
        format!(
            r#"[package]
name = "{type_id}"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
extism-pdk = "1"
serde_json = "1"
"#
        ),
    )?;
    fs::write(
        connector_dir.join("src/lib.rs"),
        r#"use extism_pdk::*;

#[plugin_fn]
pub fn execute(input: String) -> FnResult<String> {
    Ok(input)
}
"#,
    )?;
    scaffold_sample_files(connector_dir, name, type_id, ConnectorRuntime::Wasm)?;
    Ok(())
}

fn scaffold_sample_files(
    connector_dir: &Path,
    name: &str,
    type_id: &str,
    runtime: ConnectorRuntime,
) -> Result<(), ConnectorError> {
    fs::write(
        connector_dir.join("sample-input.json"),
        serde_json::to_string_pretty(&json!({
            "message": format!("hello from {type_id}")
        }))?,
    )?;
    fs::write(connector_dir.join("README.md"), scaffold_readme(name, type_id, runtime))?;
    Ok(())
}

fn scaffold_readme(name: &str, type_id: &str, runtime: ConnectorRuntime) -> String {
    let runtime_notes = match runtime {
        ConnectorRuntime::Process => {
            "Edit `main.py`, then test locally with the command below."
        }
        ConnectorRuntime::Wasm => {
            "Build the WASM artifact into `dist/connector.wasm`, enable `ACSA_ENABLE_WASM_CONNECTORS=1`, then test locally with the command below."
        }
    };

    format!(
        "# {name}\n\n\
Type: `{type_id}`\n\
Runtime: `{}`\n\n\
{runtime_notes}\n\n\
## Local test\n\n\
```bash\n\
cargo run -p acsa-core -- connector-test ./manifest.json --inputs ./sample-input.json\n\
```\n",
        match runtime {
            ConnectorRuntime::Process => "process",
            ConnectorRuntime::Wasm => "wasm",
        }
    )
}

fn resolve_secrets(params: &Value) -> Result<Value, NodeError> {
    let Some(secrets_env) = params.get("secrets_env") else {
        return Ok(json!({}));
    };
    let Some(object) = secrets_env.as_object() else {
        return Err(NodeError::InvalidParameter {
            parameter: "secrets_env".to_string(),
            message: "expected an object mapping secret keys to environment variable names"
                .to_string(),
        });
    };

    let mut secrets = serde_json::Map::new();
    for (key, value) in object {
        let Some(env_name) = value.as_str() else {
            return Err(NodeError::InvalidParameter {
                parameter: "secrets_env".to_string(),
                message: "all secret mappings must be strings".to_string(),
            });
        };
        let secret_value = std::env::var(env_name).map_err(|_| NodeError::InvalidParameter {
            parameter: "secrets_env".to_string(),
            message: format!("environment variable {env_name} is not set"),
        })?;
        secrets.insert(key.clone(), Value::String(secret_value));
    }

    Ok(Value::Object(secrets))
}

fn timeout_ms(manifest: &ConnectorManifest) -> u64 {
    manifest.limits.timeout.unwrap_or(DEFAULT_CONNECTOR_TIMEOUT_MS)
}

fn validate_manifest(
    manifest: &ConnectorManifest,
    connector_dir: &Path,
) -> Result<(), ConnectorError> {
    if manifest.name.trim().is_empty() || manifest.type_id.trim().is_empty() {
        return Err(ConnectorError::InvalidManifest {
            message: "connector manifest name and type must be non-empty".to_string(),
        });
    }
    if manifest.entry.trim().is_empty() {
        return Err(ConnectorError::InvalidManifest {
            message: "connector manifest entry must be non-empty".to_string(),
        });
    }
    let timeout_ms = manifest.limits.timeout.ok_or_else(|| ConnectorError::InvalidManifest {
        message: "connector manifest must define limits.timeout".to_string(),
    })?;
    if timeout_ms == 0 || timeout_ms > MAX_CONNECTOR_TIMEOUT_MS {
        return Err(ConnectorError::InvalidManifest {
            message: format!(
                "connector timeout must be between 1 and {MAX_CONNECTOR_TIMEOUT_MS} milliseconds"
            ),
        });
    }
    for env_name in &manifest.allowed_env {
        validate_env_name(env_name)?;
    }
    for host in &manifest.allowed_hosts {
        validate_allowed_host(host)?;
    }
    match manifest.runtime {
        ConnectorRuntime::Process => {
            let parts =
                shlex_split(&manifest.entry).ok_or_else(|| ConnectorError::InvalidManifest {
                    message: format!("connector entry {} could not be parsed", manifest.entry),
                })?;
            if parts.is_empty() {
                return Err(ConnectorError::InvalidManifest {
                    message: "process connector entry must contain a command".to_string(),
                });
            }
            validate_process_entry(connector_dir, &parts)?;
            if manifest.limits.memory.is_some() {
                return Err(ConnectorError::InvalidManifest {
                    message:
                        "process connectors do not support enforced memory limits; use wasm for memory-bounded plugins"
                            .to_string(),
                });
            }
            if manifest.enable_wasi
                || !manifest.allowed_hosts.is_empty()
                || !manifest.allowed_paths.is_empty()
            {
                return Err(ConnectorError::InvalidManifest {
                    message:
                        "process connectors cannot request WASI, allowed_hosts, or allowed_paths"
                            .to_string(),
                });
            }
        }
        ConnectorRuntime::Wasm => {
            ensure_relative_path(connector_dir, &manifest.entry)
                .map_err(|error| ConnectorError::InvalidManifest { message: error.to_string() })?;
            let memory_mb =
                manifest.limits.memory.ok_or_else(|| ConnectorError::InvalidManifest {
                    message: "wasm connectors must define limits.memory".to_string(),
                })?;
            if memory_mb > MAX_WASM_MEMORY_MB {
                return Err(ConnectorError::InvalidManifest {
                    message: format!(
                        "wasm connector memory limit must not exceed {MAX_WASM_MEMORY_MB} MB"
                    ),
                });
            }
            if !manifest.enable_wasi && !manifest.allowed_paths.is_empty() {
                return Err(ConnectorError::InvalidManifest {
                    message: "allowed_paths require enable_wasi=true".to_string(),
                });
            }
            resolve_allowed_wasi_paths(connector_dir, manifest)?;
        }
    }
    Ok(())
}

fn validate_allowed_host(host: &str) -> Result<(), ConnectorError> {
    let trimmed = host.trim();
    if trimmed.is_empty()
        || trimmed.contains("://")
        || trimmed.contains('/')
        || trimmed.contains(char::is_whitespace)
    {
        return Err(ConnectorError::InvalidManifest {
            message: format!("allowed host '{host}' must be a bare hostname or wildcard hostname"),
        });
    }
    Ok(())
}

fn validate_env_name(env_name: &str) -> Result<(), ConnectorError> {
    let is_valid = !env_name.is_empty()
        && env_name.chars().all(|character| {
            character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
        });
    if is_valid {
        Ok(())
    } else {
        Err(ConnectorError::InvalidManifest {
            message: format!(
                "environment variable '{env_name}' is invalid; use uppercase letters, digits, and underscores only"
            ),
        })
    }
}

fn validate_process_entry(connector_dir: &Path, parts: &[String]) -> Result<(), ConnectorError> {
    let executable = &parts[0];
    let executable_path = Path::new(executable);
    if executable_path.is_absolute() {
        return Err(ConnectorError::InvalidManifest {
            message:
                "process connector entry must use a relative executable or an approved launcher from PATH"
                    .to_string(),
        });
    }
    if executable_path.components().count() > 1 {
        ensure_relative_path(connector_dir, executable)
            .map_err(|error| ConnectorError::InvalidManifest { message: error.to_string() })?;
        return Ok(());
    }
    if PROCESS_LAUNCHERS.contains(&executable.as_str()) {
        return Ok(());
    }
    let candidate = connector_dir.join(executable);
    if candidate.exists() {
        return Ok(());
    }
    Err(ConnectorError::InvalidManifest {
        message: format!(
            "process connector executable '{executable}' is not allowed; use a relative executable or one of {:?}",
            PROCESS_LAUNCHERS
        ),
    })
}

fn wasm_runtime_enabled() -> bool {
    matches!(env::var(WASM_CONNECTOR_RUNTIME_ENV).as_deref(), Ok("1" | "true" | "TRUE" | "True"))
}

fn validate_output_keys(manifest: &ConnectorManifest, output: &Value) -> Result<(), NodeError> {
    if manifest.outputs.is_empty() {
        return Ok(());
    }
    let Some(object) = output.as_object() else {
        return Err(NodeError::Message {
            message: format!("connector {} must return a JSON object", manifest.type_id),
        });
    };
    for key in &manifest.outputs {
        if !object.contains_key(key) {
            return Err(NodeError::Message {
                message: format!(
                    "connector {} output is missing required key {key}",
                    manifest.type_id
                ),
            });
        }
    }
    Ok(())
}

fn validate_required_inputs(manifest: &ConnectorManifest, inputs: &Value) -> Result<(), NodeError> {
    if manifest.inputs.is_empty() {
        return Ok(());
    }
    let Some(object) = inputs.as_object() else {
        return Err(NodeError::Message {
            message: format!("connector {} expected object inputs", manifest.type_id),
        });
    };
    for key in &manifest.inputs {
        if !object.contains_key(key) {
            return Err(NodeError::Message {
                message: format!("connector {} is missing required input {key}", manifest.type_id),
            });
        }
    }
    Ok(())
}

#[derive(Debug, Error)]
pub enum ConnectorError {
    #[error("connector {connector_type} returned invalid UTF-8: {message}")]
    InvalidUtf8 { connector_type: String, message: String },
    #[error("connector manifest is invalid: {message}")]
    InvalidManifest { message: String },
    #[error(
        "connector {connector_type} exceeded the {context} size limit ({size} > {limit} bytes)"
    )]
    PayloadTooLarge { connector_type: String, context: String, size: usize, limit: usize },
    #[error("connector {connector_type} process failed: {message}")]
    ProcessFailed { connector_type: String, message: String },
    #[error("connector {connector_type} returned too much output ({size} > {limit} bytes)")]
    OutputTooLarge { connector_type: String, size: usize, limit: usize },
    #[error("connector {connector_type} runtime is disabled: {message}")]
    RuntimeDisabled { connector_type: String, message: String },
    #[error("connector {connector_type} timed out after {timeout_ms}ms")]
    Timeout { connector_type: String, timeout_ms: u64 },
    #[error("connector {connector_type} wasm runtime error: {message}")]
    WasmRuntime { connector_type: String, message: String },
    #[error("connector execution failed: {details}")]
    ExecutionFailed { details: String },
    #[error("filesystem error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, fs, path::Path};

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    use serde_json::json;

    use super::{
        run_manifest_path, scaffold_connector, validate_manifest, validate_output_keys,
        ConnectorLimits, ConnectorManifest, ConnectorRuntime,
    };

    #[test]
    fn validates_required_output_keys() {
        let manifest = ConnectorManifest {
            allowed_env: Vec::new(),
            allowed_hosts: Vec::new(),
            allowed_paths: BTreeMap::new(),
            entry: "main.py".to_string(),
            enable_wasi: false,
            inputs: vec!["message".to_string()],
            limits: ConnectorLimits::default(),
            name: "Echo".to_string(),
            outputs: vec!["echoed".to_string()],
            runtime: ConnectorRuntime::Process,
            type_id: "echo_process".to_string(),
            version: None,
        };

        assert!(validate_output_keys(&manifest, &json!({ "echoed": "ok" })).is_ok());
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn runs_process_connectors_from_a_manifest() {
        let temp_dir =
            std::env::temp_dir().join(format!("acsa-connector-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).expect("temp connector directory should be created");
        fs::write(
            temp_dir.join("manifest.json"),
            serde_json::to_string_pretty(&ConnectorManifest {
                allowed_env: Vec::new(),
                allowed_hosts: Vec::new(),
                allowed_paths: BTreeMap::new(),
                entry: "sh connector.sh".to_string(),
                enable_wasi: false,
                inputs: vec!["message".to_string()],
                limits: ConnectorLimits { memory: None, timeout: Some(1_000) },
                name: "Echo".to_string(),
                outputs: vec!["echoed".to_string()],
                runtime: ConnectorRuntime::Process,
                type_id: "echo_process".to_string(),
                version: None,
            })
            .expect("manifest should serialize"),
        )
        .expect("manifest should be written");
        fs::write(
            temp_dir.join("connector.sh"),
            "#!/bin/sh\ncat >/dev/null\nprintf '{\"echoed\":\"ok\"}'\n",
        )
        .expect("process script should be written");
        let mut permissions = fs::metadata(temp_dir.join("connector.sh"))
            .expect("script metadata should exist")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(temp_dir.join("connector.sh"), permissions)
            .expect("script should be made executable");

        let output = run_manifest_path(
            &temp_dir.join("manifest.json"),
            json!({ "message": "hi" }),
            json!({}),
        )
        .await
        .expect("connector should run");

        assert_eq!(output["echoed"], json!("ok"));
        fs::remove_dir_all(temp_dir).expect("temp connector directory should be removed");
    }

    #[test]
    fn rejects_process_manifests_without_timeouts() {
        let manifest = ConnectorManifest {
            allowed_env: Vec::new(),
            allowed_hosts: Vec::new(),
            allowed_paths: BTreeMap::new(),
            entry: "python3 main.py".to_string(),
            enable_wasi: false,
            inputs: vec![],
            limits: ConnectorLimits::default(),
            name: "Echo".to_string(),
            outputs: vec![],
            runtime: ConnectorRuntime::Process,
            type_id: "echo_process".to_string(),
            version: None,
        };

        let error = validate_manifest(&manifest, Path::new("connectors"))
            .expect_err("manifest without timeout should be rejected");

        assert!(matches!(error, super::ConnectorError::InvalidManifest { .. }));
    }

    #[test]
    fn rejects_wasm_paths_without_explicit_wasi_enablement() {
        let mut allowed_paths = BTreeMap::new();
        allowed_paths.insert("/workspace".to_string(), "data".to_string());
        let manifest = ConnectorManifest {
            allowed_env: Vec::new(),
            allowed_hosts: Vec::new(),
            allowed_paths,
            entry: "dist/connector.wasm".to_string(),
            enable_wasi: false,
            inputs: vec![],
            limits: ConnectorLimits { memory: Some(64), timeout: Some(1_000) },
            name: "Echo".to_string(),
            outputs: vec![],
            runtime: ConnectorRuntime::Wasm,
            type_id: "echo_wasm".to_string(),
            version: None,
        };

        let error = validate_manifest(&manifest, Path::new("connectors"))
            .expect_err("allowed_paths without wasi should be rejected");

        assert!(matches!(error, super::ConnectorError::InvalidManifest { .. }));
    }

    #[test]
    fn scaffolded_connectors_include_readme_and_sample_input() {
        let temp_dir = std::env::temp_dir().join(format!("acsa-scaffold-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).expect("temp connector directory should be created");

        let connector_dir =
            scaffold_connector(&temp_dir, "sample-echo", "sample_echo", ConnectorRuntime::Process)
                .expect("connector should scaffold");

        assert!(connector_dir.join("README.md").exists());
        assert!(connector_dir.join("sample-input.json").exists());

        fs::remove_dir_all(temp_dir).expect("temp connector directory should be removed");
    }
}
