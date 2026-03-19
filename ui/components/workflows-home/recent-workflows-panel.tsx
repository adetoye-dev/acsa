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

import type { ContinueWhereLeftOffItem } from "../../lib/workflows-home";
import { WorkflowListRow } from "./workflow-list-row";

export type LaunchpadEmptyState = "empty" | "no_recent_workflows" | "ready";

type RecentWorkflowsPanelProps = {
  emptyState: LaunchpadEmptyState;
  isLoading: boolean;
  items: ContinueWhereLeftOffItem[];
};

export function RecentWorkflowsPanel({
  emptyState,
  isLoading,
  items
}: RecentWorkflowsPanelProps) {
  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] rounded-[20px] border border-black/10 bg-[rgba(255,255,255,0.7)] shadow-[0_1px_0_rgba(16,20,20,0.02)]">
      <div className="flex items-center justify-between gap-4 border-b border-black/10 px-5 py-4">
        <div>
          <h2 className="text-[15px] font-medium tracking-tight text-ink">
            Continue where you left off
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate">
            Return to the workflows that were opened most recently.
          </p>
        </div>
        <span className="ui-badge">{items.length}</span>
      </div>

      <div className="sleek-scroll min-h-0 overflow-y-auto px-4 py-4">
        {isLoading ? (
          <PanelEmptyState>Loading recent workflows…</PanelEmptyState>
        ) : items.length > 0 ? (
          <div className="space-y-2.5">
            {items.map(({ recent, workflow }) => (
              <WorkflowListRow
                density="recent"
                href={`/workflows/${workflow.id}`}
                key={workflow.id}
                recentOpenedAt={recent.openedAt}
                workflow={workflow}
              />
            ))}
          </div>
        ) : (
          <PanelEmptyState>
            {emptyState === "empty"
              ? "No workflows exist yet. Start with a starter on the right."
              : "Open a workflow to have it appear here."}
          </PanelEmptyState>
        )}
      </div>
    </section>
  );
}

function PanelEmptyState({ children }: { children: string }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-[16px] border border-dashed border-black/10 bg-white/72 px-6 text-center text-sm leading-6 text-slate">
      {children}
    </div>
  );
}
