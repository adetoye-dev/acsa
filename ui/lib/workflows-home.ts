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

import type { ConnectorInventoryResponse } from "./connectors";
import { type RecentWorkflowEntry, pruneRecentWorkflows } from "./recent-workflows";
import type { WorkflowStarter } from "./workflow-starters";
import type { WorkflowSummary } from "./workflow-editor";

export type ContinueWhereLeftOffItem = {
  openedAt: number;
  recent: RecentWorkflowEntry;
  workflow: WorkflowSummary;
};

export type StarterReadinessState = "ready" | "blocked";

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
  const availableStepTypes = new Set<string>();
  for (const connector of connectorInventory?.connectors ?? []) {
    for (const providedStepType of connector.provided_step_types) {
      availableStepTypes.add(providedStepType);
    }
  }

  return starters.map((starter) => {
    const requiredStepTypes = starter.requiredStepTypes;
    const missingStepTypes = requiredStepTypes.filter(
      (stepType) => !isStepTypeAvailable(stepType, availableStepTypes)
    );

    return {
      missingStepTypes,
      ready: missingStepTypes.length === 0,
      requiredStepTypes,
      starter,
      state: missingStepTypes.length === 0 ? "ready" : "blocked"
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

  return pruneRecentWorkflows(recents).length === 0 ? "no_recent_workflows" : "ready";
}

function isStepTypeAvailable(
  stepType: string,
  availableStepTypes: Set<string>
): boolean {
  return BUILT_IN_STEP_TYPES.has(stepType) || availableStepTypes.has(stepType);
}
