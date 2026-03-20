"use client";

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

import { WorkflowCanvas } from "../workflow-canvas";
import {
  formatDuration,
  formatTimestamp,
  type RunDetailResponse,
  type RunView
} from "../../lib/observability";
import {
  type ExecutionGraphViewModel,
  executionProvenanceNote
} from "../../lib/executions-workbench";
import { TRIGGER_NODE_ID } from "../../lib/workflow-editor";

type RunGraphPanelProps = {
  graphViewModel: ExecutionGraphViewModel;
  isLoadingRunDetail: boolean;
  onSelectStepId: (stepId: string | null) => void;
  runDetail: RunDetailResponse | null;
  selectedRun: RunView | null;
  selectedStepId: string | null;
};

export function RunGraphPanel({
  graphViewModel,
  isLoadingRunDetail,
  onSelectStepId,
  runDetail,
  selectedRun,
  selectedStepId
}: RunGraphPanelProps) {
  const canvas = graphViewModel.canvas;
  const graphError = graphViewModel.error;

  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-b border-black/10">
      <div className="border-b border-black/10 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/60">
              Selected run
            </div>
            <div className="mt-1 truncate text-[15px] font-medium tracking-tight text-ink">
              {selectedRun?.workflow_name ?? "No run selected"}
            </div>
            <div className="mt-1 text-[12px] leading-5 text-slate">
              {selectedRun
                ? `${selectedRun.id.slice(0, 8)} • ${formatTimestamp(selectedRun.started_at)}`
                : "Choose a run from the left rail to inspect its graph."}
            </div>
          </div>
          {selectedRun ? (
            <RunStatusBadge status={selectedRun.status} />
          ) : null}
        </div>

        {selectedRun ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-slate/62">
            <span className="ui-badge">{formatDuration(selectedRun.duration_seconds)}</span>
            <span className="ui-badge">{runDetail?.human_tasks.length ?? 0} tasks</span>
            {selectedRun.workflow_revision ? (
              <span className="ui-badge font-mono">{selectedRun.workflow_revision}</span>
            ) : null}
          </div>
        ) : null}

        {executionProvenanceNote(selectedRun) ? (
          <div className="mt-3 text-sm leading-6 text-[#a76825]">
            {executionProvenanceNote(selectedRun)}
          </div>
        ) : null}

        {selectedRun?.error_message ? (
          <div className="mt-3 rounded-[12px] border border-rose-400/20 bg-rose-50 px-4 py-3 text-sm leading-6 text-[#c65a72]">
            {selectedRun.error_message}
          </div>
        ) : null}
      </div>

      <div className="min-h-0">
        <div className="h-full min-h-0 overflow-hidden bg-[#fbfbfc]">
          {isLoadingRunDetail && !runDetail ? (
            <PageEmptyState>Loading run detail…</PageEmptyState>
          ) : canvas ? (
            <WorkflowCanvas
              key={`execution-${selectedRun?.id ?? "empty"}-${selectedRun?.started_at ?? 0}`}
              edges={canvas.edges}
              frameRequestKey={selectedRun?.started_at ?? 0}
              nodes={canvas.nodes.map((node) => ({
                ...node,
                selected: node.id === selectedStepId
              }))}
              onAttachStepToTrigger={() => {}}
              onDeleteStep={() => {}}
              onEdgesCommit={() => {}}
              onInsertBetween={() => {}}
              onPositionsCommit={() => {}}
              onRequestAddAfterNode={() => {}}
              onSelectNode={(nodeId) =>
                onSelectStepId(nodeId && nodeId !== TRIGGER_NODE_ID ? nodeId : null)
              }
              readOnly
              showControls={false}
              showMiniMap={false}
              showViewportPanel={false}
            />
          ) : graphError ? (
            <PageEmptyState>{graphError}</PageEmptyState>
          ) : (
            <PageEmptyState>
              {selectedRun
                ? "The workflow graph is unavailable for this run."
                : "Select a run to inspect its graph."}
            </PageEmptyState>
          )}
        </div>
      </div>
    </section>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  const tone =
    status === "success"
      ? "border-emerald-400/20 bg-[#eff9f2] text-[#2e7b54]"
      : status === "failed"
        ? "border-rose-400/20 bg-[#fdf1f4] text-[#c25f76]"
        : status === "paused"
          ? "border-amber-400/20 bg-[#fdf8eb] text-[#a47123]"
          : status === "running"
            ? "border-[#6f63ff]/20 bg-[#f6f4ff] text-[#5d52d8]"
            : "border-black/10 bg-white text-[#6f8098]";

  return (
    <span
      className={`rounded-[8px] border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${tone}`}
    >
      {status}
    </span>
  );
}

function PageEmptyState({ children }: { children: string }) {
  return (
    <div className="flex min-h-[260px] items-center justify-center rounded-[12px] border border-dashed border-black/10 bg-white px-6 text-center text-sm leading-6 text-slate">
      {children}
    </div>
  );
}
