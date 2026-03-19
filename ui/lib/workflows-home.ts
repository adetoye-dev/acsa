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
  ConnectorInventoryItem,
  ConnectorInventoryResponse
} from "./connectors";
import { type RecentWorkflowEntry, pruneRecentWorkflows } from "./recent-workflows";
import type { WorkflowStarter } from "./workflow-starters";
import type { WorkflowSummary } from "./workflow-editor";

export type ContinueWhereLeftOffItem = {
  openedAt: number;
  recent: RecentWorkflowEntry;
  workflow: WorkflowSummary;
};

export type StarterReadinessState =
  | "loading"
  | "blocked_by_connector"
  | "blocked_by_setup"
  | "blocked_by_runtime"
  | "ready";

export type StarterReadinessItem = {
  missingStepTypes: string[];
  ready: boolean;
  requiredStepTypes: string[];
  starter: WorkflowStarter;
  state: StarterReadinessState;
};

const BUILT_IN_STEP_TYPES = new Set([
  "approval",
  "classification",
  "condition",
  "constant",
  "database_query",
  "embedding",
  "extraction",
  "file_read",
  "file_write",
  "http_request",
  "llm_completion",
  "loop",
  "manual_input",
  "noop",
  "parallel",
  "retrieval",
  "switch"
]);

type StarterStepAvailabilityState =
  | "ready"
  | "blocked_by_connector"
  | "blocked_by_setup"
  | "blocked_by_runtime";

export function buildContinueWhereLeftOff(
  workflows: WorkflowSummary[],
  recents: RecentWorkflowEntry[]
): ContinueWhereLeftOffItem[] {
  const workflowById = new Map(workflows.map((workflow) => [workflow.id, workflow]));

  return pruneRecentWorkflows(recents)
    .flatMap((recent) => {
      const workflow = workflowById.get(recent.workflowId);
      if (!workflow) {
        return [];
      }

      return [
        {
          openedAt: recent.openedAt,
          recent,
          workflow
        }
      ];
    })
    .slice(0, 6);
}

export function buildCompactInventory(
  workflows: WorkflowSummary[],
  featuredWorkflowIds: string[]
): WorkflowSummary[] {
  const workflowById = new Map(workflows.map((workflow) => [workflow.id, workflow]));
  const featured = featuredWorkflowIds.flatMap((workflowId) => {
    const workflow = workflowById.get(workflowId);
    return workflow ? [workflow] : [];
  });
  const featuredIds = new Set(featured.map((workflow) => workflow.id));
  const remaining = workflows
    .filter((workflow) => !featuredIds.has(workflow.id))
    .sort((left, right) =>
      left.name.localeCompare(right.name) || left.file_name.localeCompare(right.file_name)
    );

  return [...featured, ...remaining];
}

export function resolveStarterReadiness(
  starters: WorkflowStarter[],
  connectorInventory: ConnectorInventoryResponse | null
): StarterReadinessItem[] {
  if (connectorInventory === null) {
    return starters.map((starter) => ({
      missingStepTypes: [],
      ready: false,
      requiredStepTypes: starter.requiredStepTypes,
      starter,
      state: "loading"
    }));
  }

  const providersByStepType = new Map<string, ConnectorInventoryItem[]>();
  for (const connector of connectorInventory.connectors) {
    for (const providedStepType of connector.provided_step_types) {
      const providers = providersByStepType.get(providedStepType) ?? [];
      providers.push(connector);
      providersByStepType.set(providedStepType, providers);
    }
  }

  return starters.map((starter) => {
    const requiredStepTypes = starter.requiredStepTypes;
    const stepStates = requiredStepTypes.map((stepType) =>
      resolveStarterStepAvailability(stepType, providersByStepType)
    );
    const missingStepTypes = requiredStepTypes.filter(
      (_, index) => stepStates[index] !== "ready"
    );

    return {
      missingStepTypes,
      ready: missingStepTypes.length === 0,
      requiredStepTypes,
      starter,
      state: resolveStarterReadinessState(stepStates)
    };
  });
}

export function resolveLaunchpadEmptyState(
  workflows: WorkflowSummary[],
  recents: RecentWorkflowEntry[]
): "empty" | "no_recent_workflows" | "ready" {
  if (workflows.length === 0) {
    return "empty";
  }

  return buildContinueWhereLeftOff(workflows, recents).length === 0
    ? "no_recent_workflows"
    : "ready";
}

function resolveStarterReadinessState(
  stepStates: StarterStepAvailabilityState[]
): StarterReadinessState {
  if (stepStates.length === 0) {
    return "ready";
  }

  if (stepStates.every((state) => state === "ready")) {
    return "ready";
  }

  if (stepStates.some((state) => state === "blocked_by_connector")) {
    return "blocked_by_connector";
  }

  if (stepStates.some((state) => state === "blocked_by_setup")) {
    return "blocked_by_setup";
  }

  return "blocked_by_runtime";
}

function resolveStarterStepAvailability(
  stepType: string,
  providersByStepType: Map<string, ConnectorInventoryItem[]>
): StarterStepAvailabilityState {
  if (isBuiltInStepType(stepType)) {
    return "ready";
  }

  const providers = providersByStepType.get(stepType);
  if (!providers || providers.length === 0) {
    return "blocked_by_connector";
  }

  if (providers.some((provider) => isConnectorReady(provider))) {
    return "ready";
  }

  if (
    providers.some(
      (provider) =>
        provider.connector_state.setup.required_setup.length > 0 ||
        !provider.connector_state.install_validity.valid ||
        provider.connector_state.trust === "setup_required"
    )
  ) {
    return "blocked_by_setup";
  }

  return "blocked_by_runtime";
}

function isBuiltInStepType(stepType: string): boolean {
  return BUILT_IN_STEP_TYPES.has(stepType);
}

function isConnectorReady(connector: ConnectorInventoryItem): boolean {
  return (
    connector.connector_state.install_validity.valid &&
    connector.connector_state.runtime.ready &&
    connector.connector_state.setup.required_setup.length === 0
  );
}
