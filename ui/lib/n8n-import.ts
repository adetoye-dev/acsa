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

import { slugifyIdentifier, type WorkflowDocument, type WorkflowSummary } from "./workflow-editor";

export type N8nImportReportItem = {
  item_name: string;
  item_type: string;
  message: string;
};

export type N8nImportRequirementItem = {
  message: string;
  requirement_type: string;
};

export type N8nImportReport = {
  blocked: N8nImportReportItem[];
  degraded: N8nImportReportItem[];
  requirements: N8nImportRequirementItem[];
  translated: N8nImportReportItem[];
};

export type N8nImportResponse = {
  report: N8nImportReport;
  workflow_id: string;
  workflow_name: string;
  yaml: string;
};

export function nextImportedWorkflowId(
  preferredId: string,
  workflows: WorkflowSummary[],
  documents: Record<string, WorkflowDocument>
) {
  const existingIds = new Set([
    ...workflows.map((workflow) => workflow.id),
    ...Object.keys(documents)
  ]);
  const baseId = slugifyIdentifier(preferredId || "imported-n8n-workflow");

  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let index = 2;
  while (existingIds.has(`${baseId}-${index}`)) {
    index += 1;
  }
  return `${baseId}-${index}`;
}

export function importHasOpenableDraft(result: N8nImportResponse | null) {
  return Boolean(result?.yaml?.trim());
}
