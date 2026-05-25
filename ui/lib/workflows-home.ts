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
import type { WorkflowDocument, WorkflowSummary } from "./workflow-editor";

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

export function mergeLaunchpadWorkflows(
  workflows: WorkflowSummary[],
  documents: Record<string, WorkflowDocument>
): WorkflowSummary[] {
  const workflowById = new Map(workflows.map((workflow) => [workflow.id, { ...workflow }]));

  for (const document of Object.values(documents)) {
    if (!document.localDraft) {
      continue;
    }
    workflowById.set(document.id, document.summary);
  }

  return Array.from(workflowById.values()).sort((left, right) =>
    left.name.localeCompare(right.name) || left.file_name.localeCompare(right.file_name)
  );
}

export function buildRecentFirstWorkflowInventory(
  workflows: WorkflowSummary[],
  recents: RecentWorkflowEntry[]
): WorkflowSummary[] {
  const recentByWorkflowId = new Map(
    pruneRecentWorkflows(recents).map((recent) => [recent.workflowId, recent.openedAt])
  );

  return [...workflows].sort((left, right) => {
    const leftOpenedAt = recentByWorkflowId.get(left.id) ?? 0;
    const rightOpenedAt = recentByWorkflowId.get(right.id) ?? 0;
    if (leftOpenedAt !== rightOpenedAt) {
      return rightOpenedAt - leftOpenedAt;
    }

    const leftLastRun = left.workflow_state?.telemetry?.last_run_at ?? 0;
    const rightLastRun = right.workflow_state?.telemetry?.last_run_at ?? 0;
    if (leftLastRun !== rightLastRun) {
      return rightLastRun - leftLastRun;
    }

    return left.name.localeCompare(right.name) || left.file_name.localeCompare(right.file_name);
  });
}

function isBuiltInStepType(stepType: string): boolean {
  return BUILT_IN_STEP_TYPES.has(stepType);
}
