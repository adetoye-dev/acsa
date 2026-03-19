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

export type WorkflowLifecycleState = "draft" | "saved";
export type WorkflowValidationState = "valid" | "invalid";
export type WorkflowReadinessState =
  | "ready"
  | "blocked_by_connector"
  | "blocked_by_setup"
  | "blocked_by_validation";

export type WorkflowConnectorRequirements = {
  required_step_types: string[];
};

export type WorkflowReadiness = {
  connector_requirements: WorkflowConnectorRequirements;
  readiness_state: WorkflowReadinessState;
  validation_state: WorkflowValidationState;
};

export type WorkflowTelemetry = {
  last_run_at?: number | null;
  last_run_status?: string | null;
};

export type WorkflowState = {
  lifecycle: WorkflowLifecycleState;
  readiness: WorkflowReadiness;
  telemetry: WorkflowTelemetry;
};

export type ConnectorValidityState = "valid" | "invalid";
export type ConnectorRuntimeMode = "process" | "wasm";
export type ConnectorTrustState =
  | "runtime_restricted"
  | "setup_required"
  | "trusted";

export type ConnectorInstallValidity = {
  connector_dir: string;
  manifest_path?: string | null;
  reason?: string | null;
  state: ConnectorValidityState;
  valid: boolean;
};

export type ConnectorRuntimeState = {
  mode?: ConnectorRuntimeMode | null;
  ready: boolean;
};

export type ConnectorSetupState = {
  required_setup: string[];
};

export type ConnectorState = {
  install_validity: ConnectorInstallValidity;
  runtime: ConnectorRuntimeState;
  setup: ConnectorSetupState;
  trust: ConnectorTrustState;
};

export type ConnectorDependencyMetadata = {
  provided_step_types: string[];
  required_by_templates: string[];
  used_by_workflows: string[];
};

export function connectorRuntimeLabel(mode?: ConnectorRuntimeMode | null) {
  return mode === "wasm" ? "WASM" : "Process";
}

export function connectorRuntimeTone(connectorState: ConnectorState) {
  if (!connectorState.runtime.ready) {
    return "bg-ember/10 text-ember";
  }

  return connectorState.runtime.mode === "wasm"
    ? "bg-[#f2ebff] text-[#6b34d7]"
    : "bg-black/5 text-slate";
}

export function connectorTrustLabel(trust: ConnectorTrustState) {
  if (trust === "trusted") {
    return "Trusted";
  }
  if (trust === "runtime_restricted") {
    return "Runtime restricted";
  }
  return "Setup required";
}

export function connectorValidityLabel(state: ConnectorValidityState) {
  return state === "valid" ? "Valid" : "Invalid";
}

export function workflowReadinessLabel(workflowState: WorkflowState) {
  switch (workflowState.readiness.readiness_state) {
    case "ready":
      return "Ready";
    case "blocked_by_connector":
      return "Missing connector";
    case "blocked_by_setup":
      return "Setup required";
    case "blocked_by_validation":
      return "Invalid";
  }
}

export function workflowReadinessTone(workflowState: WorkflowState) {
  switch (workflowState.readiness.readiness_state) {
    case "ready":
      return "bg-emerald-50 text-[#2e7b54]";
    case "blocked_by_connector":
      return "bg-amber-50 text-[#a76825]";
    case "blocked_by_setup":
      return "bg-[#f2ebff] text-[#6b34d7]";
    case "blocked_by_validation":
      return "bg-rose-50 text-[#c65a72]";
  }
}

export function workflowLastRunLabel(workflowState: WorkflowState) {
  const status = workflowState.telemetry.last_run_status;
  if (!status) {
    return "Never run";
  }
  return `Last run: ${status}`;
}
