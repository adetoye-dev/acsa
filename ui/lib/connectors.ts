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

import type {
  ConnectorDependencyMetadata,
  ConnectorState
} from "./product-status";

export type ConnectorRuntime = "process" | "wasm";

export type ConnectorAppRecord = {
  available_version?: string | null;
  description?: string | null;
  installed_version?: string | null;
  is_locally_modified: boolean;
  name?: string | null;
  source_kind: string;
  source_ref?: string | null;
};

export type ConnectorInventoryItem = ConnectorDependencyMetadata & {
  allowed_env: string[];
  allowed_hosts: string[];
  app_record?: ConnectorAppRecord | null;
  connector_dir: string;
  connector_state: ConnectorState;
  description: string;
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

export type InvalidConnector = ConnectorDependencyMetadata & {
  app_record?: ConnectorAppRecord | null;
  connector_dir: string;
  connector_state: ConnectorState;
  error: string;
  id: string;
  manifest_path?: string | null;
};

export type ConnectorInventoryResponse = {
  connectors: ConnectorInventoryItem[];
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

type UpdateConnectorRecordRequest = {
  description: string;
  name: string;
};

export type ApplyConnectorUpdateResponse = {
  connector: ConnectorInventoryItem;
};

export type StarterConnectorPackInstallState =
  | "available"
  | "invalid"
  | "runtime_restricted"
  | "setup_required"
  | "satisfied";
