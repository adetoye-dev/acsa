/*
 * Copyright 2026 Achsah Systems
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export type ConnectorRuntime = "process" | "wasm";

export type ConnectorInventoryItem = {
  allowed_env: string[];
  allowed_hosts: string[];
  connector_dir: string;
  entry: string;
  inputs: string[];
  manifest_path: string;
  name: string;
  notes: string[];
  outputs: string[];
  readme_path?: string | null;
  runtime: ConnectorRuntime;
  runtime_ready: boolean;
  runtime_status: "ready" | "runtime_disabled" | string;
  sample_input_path?: string | null;
  type_name: string;
  version?: string | null;
};

export type InvalidConnector = {
  connector_dir: string;
  error: string;
  id: string;
  manifest_path?: string | null;
};

export type ConnectorInventoryResponse = {
  connectors: ConnectorInventoryItem[];
  connectors_dir: string;
  invalid_connectors: InvalidConnector[];
  wasm_enabled: boolean;
};

export type ConnectorScaffoldResponse = {
  connector: ConnectorInventoryItem;
  next_steps: string[];
};

export type ConnectorTestResponse = {
  connector: ConnectorInventoryItem;
  inputs: unknown;
  output: unknown;
  params: unknown;
};

export function connectorRuntimeLabel(runtime: ConnectorRuntime) {
  return runtime === "wasm" ? "WASM" : "Process";
}

export function connectorRuntimeTone(connector: ConnectorInventoryItem) {
  if (!connector.runtime_ready) {
    return "bg-ember/10 text-ember";
  }
  return connector.runtime === "wasm"
    ? "bg-tide/10 text-tide"
    : "bg-black/5 text-slate";
}
