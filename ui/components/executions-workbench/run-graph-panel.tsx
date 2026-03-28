"use client";

import { useEffect, useState } from "react";

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
  type RunDetailResponse,
  type RunView
} from "../../lib/observability";
import { type ExecutionGraphViewModel } from "../../lib/executions-workbench";
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
  const [frameKey, setFrameKey] = useState(0);

  useEffect(
    function frameExecutionGraphWhenRunChangesEffect() {
      if (!selectedRun || !canvas) {
        return;
      }
      setFrameKey((current) => current + 1);
    },
    [canvas, selectedRun?.id]
  );

  return (
    <section className="min-h-0 border-b border-black/10 bg-[#fbfbfc]">
      <div className="h-full min-h-0 overflow-hidden">
        {isLoadingRunDetail && !runDetail ? (
          <PageEmptyState>Loading run detail…</PageEmptyState>
        ) : canvas ? (
          <WorkflowCanvas
            key={`execution-${selectedRun?.id ?? "empty"}-${selectedRun?.started_at ?? 0}`}
            edges={canvas.edges}
            frameRequestKey={frameKey}
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
    </section>
  );
}

function PageEmptyState({ children }: { children: string }) {
  return (
    <div className="flex min-h-[260px] items-center justify-center rounded-[12px] border border-dashed border-black/10 bg-white px-6 text-center text-sm leading-6 text-slate">
      {children}
    </div>
  );
}
