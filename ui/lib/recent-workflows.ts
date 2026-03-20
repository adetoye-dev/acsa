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

export type RecentWorkflowEntry = {
  fileName: string;
  name: string;
  openedAt: number;
  workflowId: string;
};

export const RECENT_WORKFLOWS_STORAGE_KEY = "acsa.workflows.recent";
export const RECENT_WORKFLOWS_LIMIT = 6;

type RecentWorkflowStorage = Pick<Storage, "getItem" | "setItem">;

export function pruneRecentWorkflows(
  entries: RecentWorkflowEntry[]
): RecentWorkflowEntry[] {
  const nextEntries: RecentWorkflowEntry[] = [];
  const seenWorkflowIds = new Set<string>();

  for (const entry of [...entries].sort((left, right) => right.openedAt - left.openedAt)) {
    if (seenWorkflowIds.has(entry.workflowId)) {
      continue;
    }

    seenWorkflowIds.add(entry.workflowId);
    nextEntries.push(entry);

    if (nextEntries.length === RECENT_WORKFLOWS_LIMIT) {
      break;
    }
  }

  return nextEntries;
}

export function recordRecentWorkflowOpen(
  current: RecentWorkflowEntry[],
  nextEntry: RecentWorkflowEntry
): RecentWorkflowEntry[] {
  return pruneRecentWorkflows([
    nextEntry,
    ...current.filter((entry) => entry.workflowId !== nextEntry.workflowId)
  ]);
}

export function readRecentWorkflows(
  storage: RecentWorkflowStorage
): RecentWorkflowEntry[] {
  try {
    const raw = storage.getItem(RECENT_WORKFLOWS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return pruneRecentWorkflows(
      parsed.flatMap((entry) => {
        if (!isRecentWorkflowEntry(entry)) {
          return [];
        }

        return [
          {
            fileName: entry.fileName,
            name: entry.name,
            openedAt: entry.openedAt,
            workflowId: entry.workflowId
          }
        ];
      })
    );
  } catch {
    return [];
  }
}

export function writeRecentWorkflows(
  storage: RecentWorkflowStorage,
  entries: RecentWorkflowEntry[]
): void {
  storage.setItem(
    RECENT_WORKFLOWS_STORAGE_KEY,
    JSON.stringify(pruneRecentWorkflows(entries))
  );
}

function isRecentWorkflowEntry(value: unknown): value is RecentWorkflowEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.fileName === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.openedAt === "number" &&
    Number.isFinite(candidate.openedAt) &&
    typeof candidate.workflowId === "string"
  );
}
