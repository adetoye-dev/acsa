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

import { useMemo, type ReactNode } from "react";

import type { Edge } from "@xyflow/react";

import {
  formatDuration,
  formatTimestamp,
  type RunDetailResponse,
  type RunPageResponse,
  type StepRunView
} from "../lib/observability";
import {
  type CanvasNode,
  type NodeExecutionState,
  TRIGGER_NODE_ID
} from "../lib/workflow-editor";
import { WorkflowCanvas } from "./workflow-canvas";

type ExecutionDebuggerProps = {
  edges: Edge[];
  frameRequestKey?: number;
  isLoading: boolean;
  nodes: CanvasNode[];
  onRefresh: () => void;
  onRunStatusFilterChange: (value: string) => void;
  onSelectRun: (runId: string) => void;
  onSelectStepId: (stepId: string | null) => void;
  runDetail: RunDetailResponse | null;
  runPage: RunPageResponse | null;
  runStatusFilter: string;
  selectedRunId: string | null;
  selectedStepId: string | null;
  workflowName: string | null;
};

export function ExecutionDebugger({
  edges,
  frameRequestKey = 0,
  isLoading,
  nodes,
  onRefresh,
  onRunStatusFilterChange,
  onSelectRun,
  onSelectStepId,
  runDetail,
  runPage,
  runStatusFilter,
  selectedRunId,
  selectedStepId,
  workflowName
}: ExecutionDebuggerProps) {
  const latestStepRuns = useMemo(
    () =>
      latestAttemptByStep(runDetail?.step_runs ?? []).sort(
        (left, right) => left.started_at - right.started_at
      ),
    [runDetail]
  );

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const graphNodes = useMemo(
    () =>
      decorateNodesForExecution(nodes, workflowName, runDetail).map((node) => ({
        ...node,
        selected: node.id === selectedStepId
      })),
    [nodes, selectedStepId, runDetail, workflowName]
  );

  return (
    <div className="grid h-full min-h-0 xl:grid-cols-[290px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r border-black/10 bg-[rgba(255,255,255,0.42)]">
        <div className="border-b border-black/10 px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/60">
                Executions
              </div>
              <div className="mt-1 text-sm font-semibold text-ink">
                {runPage?.total ?? 0} run{runPage?.total === 1 ? "" : "s"}
              </div>
            </div>
            <button className="ui-button" disabled={isLoading} onClick={onRefresh} type="button">
              {isLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="border-b border-black/10 px-4 py-3.5">
          <label className="grid gap-2 text-sm text-slate" htmlFor="run-status-filter">
            Status
            <select
              className="ui-input"
              id="run-status-filter"
              onChange={(event) => onRunStatusFilterChange(event.target.value)}
              value={runStatusFilter}
            >
              <option value="">All statuses</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
              <option value="paused">Paused</option>
              <option value="running">Running</option>
            </select>
          </label>
        </div>

        <div className="sleek-scroll min-h-0 space-y-2 overflow-y-auto px-3 py-3">
          {runPage?.runs.map((run) => {
            const active = run.id === selectedRunId;
            return (
              <button
                key={run.id}
                className={`w-full rounded-[12px] border px-3.5 py-2.5 text-left transition ${runCardClassName(run.status, active)}`}
                onClick={() => onSelectRun(run.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink">
                      {run.workflow_name}
                    </div>
                    <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-slate/65">
                      {run.id.slice(0, 8)}
                    </div>
                  </div>
                  <RunStatusBadge status={run.status} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate">
                  <span>{formatTimestamp(run.started_at)}</span>
                  <span className="text-slate/35">•</span>
                  <span>{formatDuration(run.duration_seconds)}</span>
                </div>
                {run.error_message ? (
                  <div className="mt-2 line-clamp-2 text-xs leading-5 text-[#c65a72]">
                    {run.error_message}
                  </div>
                ) : null}
              </button>
            );
          })}

          {!runPage?.runs.length ? (
            <EmptyState>
              No runs exist for the active workflow with the current status filter.
            </EmptyState>
          ) : null}
        </div>
      </aside>

      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_400px]">
        {runDetail ? (
          <>
            <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-b border-black/10">
              <div className="flex items-center justify-between border-b border-black/10 px-4 py-3.5">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/60">
                    Selected run
                  </div>
                  <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-slate/65">
                    {runDetail.run.id.slice(0, 8)} • {formatTimestamp(runDetail.run.started_at)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <RunStatusBadge status={runDetail.run.status} />
                  <DebuggerMetaPill
                    label="duration"
                    value={formatDuration(runDetail.run.duration_seconds)}
                  />
                </div>
              </div>

              <div className="min-h-0">
                <div className="h-full min-h-0 overflow-hidden bg-white">
                  <WorkflowCanvas
                    key={`execution-${runDetail.run.id}-${frameRequestKey}`}
                    edges={edges}
                    frameRequestKey={frameRequestKey}
                    nodes={graphNodes}
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
                </div>
              </div>
            </section>

            <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <div className="border-b border-black/10 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/60">
                  Steps
                </div>
                <div className="mt-1 text-sm font-semibold text-ink">
                  {latestStepRuns.length} step{latestStepRuns.length === 1 ? "" : "s"} in run
                </div>
              </div>

              <div className="sleek-scroll min-h-0 space-y-1.5 overflow-y-auto px-3 py-3">
                {latestStepRuns.map((stepRun) => {
                  const active = stepRun.step_id === selectedStepId;
                  const stepLabel = nodeById.get(stepRun.step_id)?.data.label ?? stepRun.step_id;
                  return (
                    <button
                      key={stepRun.id}
                      className={`w-full rounded-[12px] border px-3 py-2 text-left transition ${stepRunCardClassName(stepRun.status, active)}`}
                      onClick={() => onSelectStepId(stepRun.step_id)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-ink">
                            {stepLabel}
                          </div>
                          <div className="mt-1 truncate font-mono text-[11px] uppercase tracking-[0.16em] text-slate/65">
                            {stepRun.step_id}
                          </div>
                        </div>
                        <RunStatusBadge status={stepRun.status} />
                      </div>
                      <div className="mt-1 truncate text-xs text-slate">
                        attempt {stepRun.attempt} • {formatDuration(stepRun.duration_seconds)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-8">
            <EmptyState>Select a run to inspect timeline details and structured logs.</EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}

function DebuggerMetaPill({
  label,
  tone = "neutral",
  value
}: {
  label: string;
  tone?: "neutral" | "rose" | "teal";
  value: string;
}) {
  const toneClass =
    tone === "rose"
      ? "border-rose-400/18 bg-rose-400/10 text-[#c65a72]"
      : tone === "teal"
        ? "border-[#6f63ff]/18 bg-[#f6f4ff] text-[#5d52d8]"
        : "border-black/10 bg-white/72 text-[#5d6d85]";

  return (
    <span
      className={`rounded-[8px] border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${toneClass}`}
    >
      {label}: {value}
    </span>
  );
}

function latestAttemptByStep(stepRuns: StepRunView[]) {
  return Array.from(buildLatestStepRunMap(stepRuns).values());
}

function buildLatestStepRunMap(stepRuns: StepRunView[]) {
  const latestByStep = new Map<string, StepRunView>();
  for (const stepRun of stepRuns) {
    const current = latestByStep.get(stepRun.step_id);
    if (!current || stepRun.attempt > current.attempt) {
      latestByStep.set(stepRun.step_id, stepRun);
    } else if (
      stepRun.attempt === current.attempt &&
      (stepRun.started_at ?? 0) > (current.started_at ?? 0)
    ) {
      latestByStep.set(stepRun.step_id, stepRun);
    }
  }

  return latestByStep;
}

function decorateNodesForExecution(
  nodes: CanvasNode[],
  workflowName: string | null,
  runDetail: RunDetailResponse | null
) {
  if (!runDetail || (workflowName && runDetail.run.workflow_name !== workflowName)) {
    return nodes.map((node) => ({
      ...node,
      type: "workflowNode",
      data: {
        ...node.data,
        executionLabel: null,
        executionMeta: null,
        executionState: "idle" as const
      }
    }));
  }

  const latestByStep = buildLatestStepRunMap(runDetail.step_runs);

  const pendingTaskStepIds = new Set(
    runDetail.human_tasks
      .filter((task) => task.status === "pending")
      .map((task) => task.step_id)
  );

  return nodes.map((node) => {
    if (node.id === TRIGGER_NODE_ID) {
      const runState = normalizeExecutionState(runDetail.run.status);
      return {
        ...node,
        type: "workflowNode",
        data: {
          ...node.data,
          executionLabel: executionLabel(runState),
          executionMeta: runDetail.run.id.slice(0, 8),
          executionState: runState
        }
      };
    }

    const latestStepRun = latestByStep.get(node.id);
    let state: NodeExecutionState = "idle";
    if (pendingTaskStepIds.has(node.id)) {
      state = "paused";
    } else if (latestStepRun) {
      state = normalizeExecutionState(latestStepRun.status);
    }

    return {
      ...node,
      type: "workflowNode",
      data: {
        ...node.data,
        executionLabel: executionLabel(state),
        executionMeta: latestStepRun ? executionMeta(state, latestStepRun) : null,
        executionState: state
      }
    };
  });
}

function normalizeExecutionState(status: string): NodeExecutionState {
  switch (status) {
    case "failed":
      return "failed";
    case "paused":
      return "paused";
    case "running":
      return "running";
    case "skipped":
      return "skipped";
    case "success":
      return "success";
    default:
      return "idle";
  }
}

function executionLabel(state: NodeExecutionState) {
  switch (state) {
    case "success":
      return "success";
    case "failed":
      return "failed";
    case "paused":
      return "paused";
    case "running":
      return "running";
    case "skipped":
      return "skipped";
    default:
      return null;
  }
}

function executionMeta(state: NodeExecutionState, stepRun: StepRunView) {
  switch (state) {
    case "running":
      return `attempt ${stepRun.attempt}`;
    case "success":
    case "failed":
    case "paused":
    case "skipped":
      return formatDuration(stepRun.duration_seconds);
    default:
      return null;
  }
}

function runCardClassName(status: string, active: boolean) {
  if (active) {
    return "border-[#cfc6ff] bg-[#f7f5ff]";
  }

  switch (status) {
    case "failed":
      return "border-black/10 bg-white hover:border-rose-400/25";
    case "paused":
      return "border-black/10 bg-white hover:border-amber-400/25";
    case "running":
      return "border-black/10 bg-white hover:border-[#6f63ff]/28";
    default:
      return "border-black/10 bg-white hover:border-black/18";
  }
}

function stepRunCardClassName(status: string, active: boolean) {
  if (active) {
    return "border-[#cfc6ff] bg-[#f7f5ff]";
  }

  switch (status) {
    case "failed":
      return "border-black/10 bg-white hover:border-rose-400/25";
    case "paused":
      return "border-black/10 bg-white hover:border-amber-400/25";
    case "running":
      return "border-black/10 bg-white hover:border-[#6f63ff]/28";
    default:
      return "border-black/10 bg-white hover:border-black/18";
  }
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

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[12px] border border-dashed border-black/10 bg-white px-4 py-8 text-center text-sm leading-6 text-slate">
      {children}
    </div>
  );
}
