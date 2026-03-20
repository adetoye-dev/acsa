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

pub use crate::starter_connector_packs;

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

#[derive(Debug, Clone)]
pub struct DiscoveredConnector {
    pub connector_dir: PathBuf,
    pub manifest: ConnectorManifest,
    pub manifest_path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct InvalidConnector {
    pub connector_dir: PathBuf,
    pub error: String,
    pub attempted_type_id: Option<String>,
    pub manifest_path: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct ConnectorInspection {
    pub connectors: Vec<DiscoveredConnector>,
    pub invalid: Vec<InvalidConnector>,
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

    for connector in inspect_connectors(connectors_dir)?.connectors {
        let connector_dir = connector.connector_dir;
        let manifest = connector.manifest;
        let type_id = manifest.type_id.clone();
        registry.register(ConnectorNode { connector_dir, manifest });
        loaded.push(type_id);
    }

    Ok(loaded)
}

pub fn discover_connector_manifests(
    connectors_dir: &Path,
) -> Result<Vec<ConnectorManifest>, ConnectorError> {
    inspect_connectors(connectors_dir).map(|inspection| {
        inspection.connectors.into_iter().map(|connector| connector.manifest).collect()
    })
}

pub fn inspect_connectors(connectors_dir: &Path) -> Result<ConnectorInspection, ConnectorError> {
    if !connectors_dir.exists() {
        return Ok(ConnectorInspection { connectors: Vec::new(), invalid: Vec::new() });
    }

    let mut connectors = Vec::new();
    let mut invalid = Vec::new();
    let mut entries = Vec::new();
    for entry in fs::read_dir(connectors_dir)? {
        match entry {
            Ok(dir_entry) => entries.push(dir_entry),
            Err(error) => {
                invalid.push(InvalidConnector {
                    connector_dir: connectors_dir.to_path_buf(),
                    error: format!("failed to read connector directory entry: {error}"),
                    attempted_type_id: None,
                    manifest_path: None,
                });
            }
        }
    }
    entries.sort_by_key(|entry| entry.path());

    for entry in entries {
        let entry_path = entry.path();
        let canonical_dir = match fs::canonicalize(&entry_path) {
            Ok(path) => path,
            Err(error) => {
                invalid.push(InvalidConnector {
                    connector_dir: entry_path,
                    error: error.to_string(),
                    attempted_type_id: None,
                    manifest_path: None,
                });
                continue;
            }
        };
        if !canonical_dir.is_dir() {
            continue;
        }
        let manifest_path = canonical_dir.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }

        let raw_manifest = match fs::read_to_string(&manifest_path) {
            Ok(raw_manifest) => raw_manifest,
            Err(error) => {
                invalid.push(InvalidConnector {
                    connector_dir: canonical_dir,
                    error: error.to_string(),
                    attempted_type_id: None,
                    manifest_path: Some(manifest_path),
                });
                continue;
            }
        };

        let manifest = match load_manifest_from_str(&raw_manifest) {
            Ok(manifest) => manifest,
            Err(error) => {
                invalid.push(InvalidConnector {
                    connector_dir: canonical_dir,
                    error: error.to_string(),
                    attempted_type_id: attempted_type_id_from_raw_manifest(&raw_manifest),
                    manifest_path: Some(manifest_path),
                });
                continue;
            }
        };

        if let Err(error) = validate_manifest(&manifest, &canonical_dir) {
            invalid.push(InvalidConnector {
                connector_dir: canonical_dir,
                error: error.to_string(),
                attempted_type_id: Some(manifest.type_id.clone()),
                manifest_path: Some(manifest_path),
            });
            continue;
        }

        connectors.push(DiscoveredConnector {
            connector_dir: canonical_dir,
            manifest,
            manifest_path,
        });
    }

    Ok(ConnectorInspection { connectors, invalid })
}

pub fn load_manifest(path: &Path) -> Result<ConnectorManifest, ConnectorError> {
    let raw = fs::read_to_string(path)?;
    load_manifest_from_str(&raw)
}

fn load_manifest_from_str(raw: &str) -> Result<ConnectorManifest, ConnectorError> {
    let manifest = serde_json::from_str::<ConnectorManifest>(raw)?;
    Ok(manifest)
}

fn attempted_type_id_from_raw_manifest(raw: &str) -> Option<String> {
    extract_json_string_field(raw, "type")
}

fn extract_json_string_field(raw: &str, key: &str) -> Option<String> {
    let key_pattern = format!(r#""{key}""#);
    let mut search_start = 0;

    while let Some(relative_key_start) = raw[search_start..].find(&key_pattern) {
        let key_start = search_start + relative_key_start;
        let after_key = &raw[key_start + key_pattern.len()..];
        let colon_offset = after_key.find(':')?;
        let after_colon = &after_key[colon_offset + 1..];
        let value_offset = after_colon
            .char_indices()
            .find(|(_, character)| !character.is_whitespace())
            .map(|(index, _)| index)?;
        let value = &after_colon[value_offset..];

        if !value.starts_with('"') {
            search_start = key_start + key_pattern.len();
            continue;
        }

        let end_quote = find_json_string_end(value)?;
        let literal = &value[..=end_quote];
        if let Ok(parsed) = serde_json::from_str::<String>(literal) {
            return Some(parsed);
        }

        search_start = key_start + key_pattern.len();
    }

    None
}

fn find_json_string_end(value: &str) -> Option<usize> {
    let mut escaped = false;

    for (index, character) in value.char_indices().skip(1) {
        if escaped {
            escaped = false;
            continue;
        }

        match character {
            '\\' => escaped = true,
            '"' => return Some(index),
            _ => {}
        }
    }

    None
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StarterConnectorPackInstallResult {
    Installed { connector_dir: PathBuf },
    AlreadyInstalled { connector_dir: PathBuf },
}

pub fn install_starter_connector_pack(
    connectors_dir: &Path,
    pack: &starter_connector_packs::StarterConnectorPack,
) -> Result<StarterConnectorPackInstallResult, ConnectorError> {
    fs::create_dir_all(connectors_dir)?;
    let connector_dir = connectors_dir.join(pack.install_dir_name);
    if connector_dir.exists() {
        return Ok(StarterConnectorPackInstallResult::AlreadyInstalled { connector_dir });
    }

    copy_dir_all(Path::new(pack.source_dir), &connector_dir)?;
    Ok(StarterConnectorPackInstallResult::Installed { connector_dir })
}

fn copy_dir_all(source_dir: &Path, target_dir: &Path) -> Result<(), ConnectorError> {
    if !source_dir.exists() {
        return Err(ConnectorError::InvalidManifest {
            message: format!(
                "starter pack template directory {} does not exist",
                source_dir.display()
            ),
        });
    }

    fs::create_dir_all(target_dir)?;
    for entry in fs::read_dir(source_dir)? {
        let entry = entry?;
        let entry_path = entry.path();
        let target_path = target_dir.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry_path, &target_path)?;
        } else {
            fs::copy(&entry_path, &target_path)?;
        }
    }
    Ok(())
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

pub fn wasm_connectors_enabled() -> bool {
    wasm_runtime_enabled()
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
    use std::{
        collections::BTreeMap,
        fs,
        path::{Path, PathBuf},
        sync::OnceLock,
    };

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    use serde_json::json;
    use tokio::{
        io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
        net::TcpListener,
        sync::Mutex,
        task::JoinHandle,
    };

    use super::{
        inspect_connectors, run_manifest_path, scaffold_connector, validate_manifest,
        validate_output_keys, ConnectorLimits, ConnectorManifest, ConnectorRuntime,
    };

    #[test]
    fn starter_pack_catalog_lists_curated_first_party_packs() {
        let catalog = super::starter_connector_packs::starter_connector_packs();
        let ids = catalog.iter().map(|pack| pack.id).collect::<Vec<_>>();

        assert_eq!(
            ids,
            vec!["slack-notify", "github-issue-create", "google-sheets-append-row", "email-send",]
        );
        assert_eq!(catalog[0].provided_step_types, &["slack.notify"]);
    }

    #[test]
    fn install_starter_pack_copies_template_files_into_connectors_dir() {
        let temp_dir =
            std::env::temp_dir().join(format!("acsa-starter-install-{}", uuid::Uuid::new_v4()));
        let connectors_dir = temp_dir.join("connectors");
        fs::create_dir_all(&connectors_dir).expect("connectors dir should be created");

        let pack = super::starter_connector_packs::starter_connector_pack("slack-notify")
            .expect("starter pack should exist");
        let result = super::install_starter_connector_pack(&connectors_dir, pack)
            .expect("starter pack should install");

        match result {
            super::StarterConnectorPackInstallResult::Installed {
                connector_dir: installed_dir,
            } => {
                assert_eq!(installed_dir, connectors_dir.join("slack-notify"));
            }
            super::StarterConnectorPackInstallResult::AlreadyInstalled { .. } => {
                panic!("starter pack should install fresh into an empty connectors dir");
            }
        }

        let installed_dir = connectors_dir.join("slack-notify");
        assert!(installed_dir.join("manifest.json").exists());
        assert!(installed_dir.join("main.py").exists());
        assert!(installed_dir.join("README.md").exists());

        let inspection =
            inspect_connectors(&connectors_dir).expect("installed connectors should inspect");
        assert_eq!(inspection.connectors.len(), 1);
        assert_eq!(inspection.connectors[0].manifest.type_id, "slack_notify");

        fs::remove_dir_all(temp_dir).expect("temp directory should be removed");
    }

    #[test]
    fn install_starter_pack_does_not_overwrite_existing_connector_dir() {
        let temp_dir =
            std::env::temp_dir().join(format!("acsa-starter-existing-{}", uuid::Uuid::new_v4()));
        let connectors_dir = temp_dir.join("connectors");
        let existing_connector_dir = connectors_dir.join("slack-notify");
        fs::create_dir_all(&existing_connector_dir)
            .expect("existing connector dir should be created");
        fs::write(existing_connector_dir.join("main.py"), "sentinel")
            .expect("sentinel file should write");
        fs::write(
            existing_connector_dir.join("manifest.json"),
            serde_json::to_string_pretty(&ConnectorManifest {
                allowed_env: Vec::new(),
                allowed_hosts: Vec::new(),
                allowed_paths: BTreeMap::new(),
                entry: "main.py".to_string(),
                enable_wasi: false,
                inputs: vec!["message".to_string()],
                limits: ConnectorLimits { memory: None, timeout: Some(1_000) },
                name: "Slack Notify".to_string(),
                outputs: vec!["sent".to_string()],
                runtime: ConnectorRuntime::Process,
                type_id: "slack_notify".to_string(),
                version: Some("0.1.0".to_string()),
            })
            .expect("manifest should serialize"),
        )
        .expect("manifest should write");

        let pack = super::starter_connector_packs::starter_connector_pack("slack-notify")
            .expect("starter pack should exist");
        let result = super::install_starter_connector_pack(&connectors_dir, pack)
            .expect("starter pack install should succeed");

        match result {
            super::StarterConnectorPackInstallResult::AlreadyInstalled { connector_dir } => {
                assert_eq!(connector_dir, existing_connector_dir);
            }
            super::StarterConnectorPackInstallResult::Installed { .. } => {
                panic!("starter pack should not overwrite an existing connector dir");
            }
        }

        assert_eq!(
            fs::read_to_string(existing_connector_dir.join("main.py"))
                .expect("main.py should remain"),
            "sentinel"
        );

        fs::remove_dir_all(temp_dir).expect("temp directory should be removed");
    }

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

    #[test]
    fn inspection_keeps_valid_connectors_when_a_neighbor_manifest_is_invalid() {
        let temp_dir = std::env::temp_dir().join(format!("acsa-inspect-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).expect("temp connector directory should be created");

        let valid_dir = temp_dir.join("valid");
        fs::create_dir_all(&valid_dir).expect("valid connector dir should be created");
        fs::write(
            valid_dir.join("manifest.json"),
            serde_json::to_string_pretty(&ConnectorManifest {
                allowed_env: Vec::new(),
                allowed_hosts: Vec::new(),
                allowed_paths: BTreeMap::new(),
                entry: "python3 main.py".to_string(),
                enable_wasi: false,
                inputs: vec!["message".to_string()],
                limits: ConnectorLimits { memory: None, timeout: Some(1_000) },
                name: "valid".to_string(),
                outputs: vec!["echoed".to_string()],
                runtime: ConnectorRuntime::Process,
                type_id: "valid_connector".to_string(),
                version: Some("0.1.0".to_string()),
            })
            .expect("valid manifest should serialize"),
        )
        .expect("valid manifest should be written");
        fs::write(valid_dir.join("main.py"), "print('{}')")
            .expect("valid script should be written");

        let invalid_dir = temp_dir.join("invalid");
        fs::create_dir_all(&invalid_dir).expect("invalid connector dir should be created");
        fs::write(invalid_dir.join("manifest.json"), "{invalid json")
            .expect("invalid manifest should be written");

        let inspection =
            inspect_connectors(&temp_dir).expect("connector inspection should succeed");
        assert_eq!(inspection.connectors.len(), 1);
        assert_eq!(inspection.connectors[0].manifest.type_id, "valid_connector");
        assert_eq!(inspection.invalid.len(), 1);

        fs::remove_dir_all(temp_dir).expect("temp connector directory should be removed");
    }

    #[test]
    fn inspection_records_attempted_type_id_for_invalid_manifests() {
        let temp_dir =
            std::env::temp_dir().join(format!("acsa-inspect-type-id-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).expect("temp connector directory should be created");

        let invalid_dir = temp_dir.join("broken");
        fs::create_dir_all(&invalid_dir).expect("invalid connector dir should be created");
        fs::write(
            invalid_dir.join("manifest.json"),
            serde_json::to_string_pretty(&ConnectorManifest {
                allowed_env: Vec::new(),
                allowed_hosts: Vec::new(),
                allowed_paths: BTreeMap::new(),
                entry: "python3 main.py".to_string(),
                enable_wasi: false,
                inputs: vec!["message".to_string()],
                limits: ConnectorLimits { memory: None, timeout: None },
                name: "broken".to_string(),
                outputs: vec!["echoed".to_string()],
                runtime: ConnectorRuntime::Process,
                type_id: "broken_connector".to_string(),
                version: Some("0.1.0".to_string()),
            })
            .expect("invalid manifest should serialize"),
        )
        .expect("invalid manifest should be written");

        let inspection =
            inspect_connectors(&temp_dir).expect("connector inspection should succeed");
        assert_eq!(inspection.invalid.len(), 1);
        assert_eq!(inspection.invalid[0].attempted_type_id.as_deref(), Some("broken_connector"));

        fs::remove_dir_all(temp_dir).expect("temp connector directory should be removed");
    }

    #[test]
    fn inspection_recovers_attempted_type_id_from_malformed_manifest_json() {
        let temp_dir =
            std::env::temp_dir().join(format!("acsa-inspect-parse-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).expect("temp connector directory should be created");

        let invalid_dir = temp_dir.join("broken");
        fs::create_dir_all(&invalid_dir).expect("invalid connector dir should be created");
        fs::write(
            invalid_dir.join("manifest.json"),
            r#"{
  "entry": "main.py",
  "inputs": ["message"],
  "name": "broken",
  "outputs": ["echoed"],
  "runtime": "process",
  "type": "broken_connector",
}"#,
        )
        .expect("malformed manifest should be written");

        let inspection =
            inspect_connectors(&temp_dir).expect("connector inspection should succeed");
        assert_eq!(inspection.invalid.len(), 1);
        assert_eq!(inspection.invalid[0].attempted_type_id.as_deref(), Some("broken_connector"));

        fs::remove_dir_all(temp_dir).expect("temp connector directory should be removed");
    }

    #[tokio::test]
    async fn ai_news_collector_normalizes_deduplicates_and_ranks_fixture_data() {
        let manifest_path = repo_root().join("connectors/ai-news-collector/manifest.json");
        let params = json!({
            "product_name": "Acsa",
            "rss_sources": [
                { "name": "OpenAI", "fixture_path": "fixtures/openai.xml" },
                { "name": "Anthropic", "fixture_path": "fixtures/anthropic.xml" },
                { "name": "Hugging Face", "fixture_path": "fixtures/huggingface.xml" },
                { "name": "Google AI", "fixture_path": "fixtures/google-ai.xml" }
            ],
            "hn": {
                "fixture_path": "fixtures/hn.json",
                "keywords": ["ai", "openai", "anthropic", "claude", "gpt", "model", "agent", "inference"],
                "max_matches": 4
            },
            "max_feed_items_per_source": 3,
            "max_ranked_items": 6,
            "timeout_secs": 2
        });

        let output = run_manifest_path(&manifest_path, json!({}), params)
            .await
            .expect("collector should succeed on fixture data");

        assert_eq!(output["sources_succeeded"], json!(5));
        assert_eq!(output["sources_failed"], json!(0));
        assert_eq!(output["item_count"], json!(5));
        assert!(output["prompt"].as_str().is_some_and(|prompt| prompt.contains("Why they matter")));
        let ranked = output["ranked_items"].as_array().expect("ranked_items should be an array");
        assert_eq!(ranked.len(), 5);
        assert_eq!(
            ranked
                .iter()
                .filter(|item| {
                    item.get("title")
                        == Some(&json!("OpenAI launches eval tooling for agent workflows"))
                })
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn ai_news_collector_tolerates_partial_source_failure() {
        let manifest_path = repo_root().join("connectors/ai-news-collector/manifest.json");
        let params = json!({
            "rss_sources": [
                { "name": "OpenAI", "fixture_path": "fixtures/openai.xml" },
                { "name": "Broken Feed", "fixture_path": "fixtures/missing.xml" }
            ],
            "hn": {
                "fixture_path": "fixtures/hn.json",
                "keywords": ["ai", "openai", "anthropic", "claude", "gpt", "model", "agent", "inference"],
                "max_matches": 2
            },
            "max_feed_items_per_source": 2,
            "max_ranked_items": 4,
            "timeout_secs": 2
        });

        let output = run_manifest_path(&manifest_path, json!({}), params)
            .await
            .expect("collector should still succeed when some sources fail");

        assert_eq!(output["sources_succeeded"], json!(2));
        assert_eq!(output["sources_failed"], json!(1));
        assert!(output["item_count"].as_u64().unwrap_or(0) >= 1);
    }

    #[tokio::test]
    async fn smtp_connector_reports_missing_secret_env_clearly() {
        let manifest_path = repo_root().join("connectors/smtp-email-delivery/manifest.json");
        let error = run_manifest_path(
            &manifest_path,
            json!({ "subject": "Acsa test", "body": "hello" }),
            json!({
                "secrets_env": { "password": "ACSA_SMTP_PASSWORD_MISSING_TEST" }
            }),
        )
        .await
        .expect_err("smtp connector should fail when the password env is missing");

        assert!(error
            .to_string()
            .contains("environment variable ACSA_SMTP_PASSWORD_MISSING_TEST is not set"));
    }

    #[tokio::test]
    async fn smtp_connector_can_send_to_a_local_mock_server() {
        let _env_guard = env_lock().lock().await;
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("smtp listener should bind");
        let address = listener.local_addr().expect("smtp listener should expose a local addr");
        let server = spawn_mock_smtp(listener);

        let _host = EnvVarGuard::set("ACSA_SMTP_HOST", "127.0.0.1");
        let _port = EnvVarGuard::set("ACSA_SMTP_PORT", &address.port().to_string());
        let _username = EnvVarGuard::set("ACSA_SMTP_USERNAME", "demo-user@example.com");
        let _password = EnvVarGuard::set("ACSA_SMTP_PASSWORD", "demo-password");
        let _from = EnvVarGuard::set("ACSA_SMTP_FROM", "acsa@example.com");
        let _to = EnvVarGuard::set("ACSA_DEMO_EMAIL_TO", "user@example.com");
        let _tls = EnvVarGuard::set("ACSA_SMTP_TLS", "false");

        let manifest_path = repo_root().join("connectors/smtp-email-delivery/manifest.json");
        let output = run_manifest_path(
            &manifest_path,
            json!({ "subject": "Acsa test", "body": "Daily brief body" }),
            json!({
                "secrets_env": { "password": "ACSA_SMTP_PASSWORD" }
            }),
        )
        .await
        .expect("smtp connector should send successfully");

        assert_eq!(output["sent"], json!(true));
        assert_eq!(output["recipient"], json!("user@example.com"));
        server.await.expect("smtp server task should complete");
    }

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("crate directory should have a repo parent")
            .to_path_buf()
    }

    fn env_lock() -> &'static Mutex<()> {
        static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        ENV_LOCK.get_or_init(|| Mutex::new(()))
    }

    struct EnvVarGuard {
        key: String,
        previous: Option<String>,
    }

    impl EnvVarGuard {
        fn set(key: &str, value: &str) -> Self {
            let previous = std::env::var(key).ok();
            unsafe {
                std::env::set_var(key, value);
            }
            Self { key: key.to_string(), previous }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.previous {
                Some(value) => unsafe {
                    std::env::set_var(&self.key, value);
                },
                None => unsafe {
                    std::env::remove_var(&self.key);
                },
            }
        }
    }

    fn spawn_mock_smtp(listener: TcpListener) -> JoinHandle<()> {
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.expect("smtp client should connect");
            let (reader, mut writer) = stream.into_split();
            let mut reader = BufReader::new(reader);
            writer
                .write_all(b"220 mock-smtp ESMTP\r\n")
                .await
                .expect("smtp banner should be written");

            let mut line = String::new();
            loop {
                line.clear();
                let bytes = reader.read_line(&mut line).await.expect("smtp line should read");
                if bytes == 0 {
                    break;
                }
                let upper = line.to_ascii_uppercase();

                if upper.starts_with("EHLO") || upper.starts_with("HELO") {
                    writer
                        .write_all(b"250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n")
                        .await
                        .expect("smtp ehlo response should be written");
                } else if upper.starts_with("AUTH PLAIN") {
                    writer
                        .write_all(b"235 2.7.0 Authentication successful\r\n")
                        .await
                        .expect("smtp auth response should be written");
                } else if upper.starts_with("AUTH LOGIN") {
                    writer
                        .write_all(b"334 VXNlcm5hbWU6\r\n")
                        .await
                        .expect("smtp auth challenge should be written");
                } else if line.trim() == "ZGVtby11c2Vy" {
                    writer
                        .write_all(b"334 UGFzc3dvcmQ6\r\n")
                        .await
                        .expect("smtp password challenge should be written");
                } else if line.trim() == "ZGVtby1wYXNzd29yZA==" {
                    writer
                        .write_all(b"235 2.7.0 Authentication successful\r\n")
                        .await
                        .expect("smtp login completion should be written");
                } else if upper.starts_with("MAIL FROM:") || upper.starts_with("RCPT TO:") {
                    writer
                        .write_all(b"250 2.1.5 OK\r\n")
                        .await
                        .expect("smtp recipient response should be written");
                } else if upper.starts_with("DATA") {
                    writer
                        .write_all(b"354 End data with <CR><LF>.<CR><LF>\r\n")
                        .await
                        .expect("smtp data challenge should be written");
                    loop {
                        line.clear();
                        let bytes_read =
                            reader.read_line(&mut line).await.expect("smtp data should read");
                        if bytes_read == 0 {
                            return;
                        }
                        if line == ".\r\n" {
                            break;
                        }
                    }
                    writer
                        .write_all(b"250 2.0.0 Accepted\r\n")
                        .await
                        .expect("smtp data response should be written");
                } else if upper.starts_with("QUIT") {
                    writer
                        .write_all(b"221 2.0.0 Bye\r\n")
                        .await
                        .expect("smtp quit response should be written");
                    break;
                } else {
                    writer
                        .write_all(b"250 OK\r\n")
                        .await
                        .expect("smtp default response should be written");
                }
            }
        })
    }
}
