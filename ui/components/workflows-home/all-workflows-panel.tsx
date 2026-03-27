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

import type { InvalidWorkflowFile, WorkflowSummary } from "../../lib/workflow-editor";
import { WorkflowListRow } from "./workflow-list-row";
import type { LaunchpadEmptyState } from "./recent-workflows-panel";

export type AllWorkflowsPanelEmptyState = LaunchpadEmptyState;

type AllWorkflowsPanelProps = {
  emptyState: AllWorkflowsPanelEmptyState;
  invalidFiles: InvalidWorkflowFile[];
  isLoading: boolean;
  workflows: WorkflowSummary[];
};

export function AllWorkflowsPanel({
  emptyState,
  invalidFiles,
  isLoading,
  workflows
}: AllWorkflowsPanelProps) {
  return (
    <section className="grid min-h-0 grid-rows-[56px_minmax(0,1fr)] border-t border-black/10 bg-white">
      <div className="flex items-center justify-between gap-4 border-b border-black/10 px-5">
        <h2 className="text-[15px] font-medium tracking-tight text-ink">All workflows</h2>
        <span className="ui-badge">{workflows.length}</span>
      </div>

      <div className="sleek-scroll min-h-0 overflow-y-auto px-4 py-4">
        {isLoading ? (
          <PanelEmptyState>Loading workflow inventory…</PanelEmptyState>
        ) : workflows.length > 0 ? (
          <div className="space-y-2.5">
            {workflows.map((workflow) => (
              <WorkflowListRow
                density="compact"
                href={`/workflows/${workflow.id}`}
                key={workflow.id}
                workflow={workflow}
              />
            ))}
          </div>
        ) : (
          <PanelEmptyState>
            No saved workflows yet. Use the starter rail to create the first draft.
          </PanelEmptyState>
        )}

        <div className="mt-4 border-t border-black/10 px-0 pt-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-medium tracking-tight text-ink">Invalid YAML files</h3>
            <span className="ui-badge">{invalidFiles.length}</span>
          </div>

          <div className="mt-3">
            {invalidFiles.length > 0 ? (
              <div className="space-y-3">
                {invalidFiles.map((file) => (
                  <div
                    className="rounded-[14px] border border-rose-400/18 bg-rose-50/65 px-4 py-3"
                    key={file.id}
                  >
                    <div className="text-sm font-semibold text-ink">{file.file_name}</div>
                    <div className="mt-1 text-sm leading-6 text-[#c65a72]">{file.error}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[14px] border border-black/10 bg-white px-4 py-3 text-sm leading-6 text-slate">
                No invalid workflow files.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function PanelEmptyState({ children }: { children: string }) {
  return (
    <div className="flex min-h-[188px] items-center justify-center px-6 text-center text-sm leading-6 text-slate">
      {children}
    </div>
  );
}
