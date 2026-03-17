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

import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { Edge } from "@xyflow/react";

import {
  formatDuration,
  formatTimestamp,
  type LogPageResponse,
  type RunDetailResponse,
  type RunPageResponse,
  type StepRunView
} from "../lib/observability";
import {
  type NodeExecutionState,
  TRIGGER_NODE_ID,
  type CanvasNode
} from "../lib/workflow-editor";
import { WorkflowCanvas } from "./workflow-canvas";

type ExecutionDebuggerProps = {
  defaultPane: "logs" | "output";
  edges: Edge[];
  isLoading: boolean;
  logLevelFilter: string;
  logSearch: string;
  logs: LogPageResponse | null;
  nodes: CanvasNode[];
  onLogLevelFilterChange: (value: string) => void;
  onLogSearchChange: (value: string) => void;
  onRefresh: () => void;
  onRunStatusFilterChange: (value: string) => void;
  onSelectRun: (runId: string) => void;
  runDetail: RunDetailResponse | null;
  runPage: RunPageResponse | null;
  runStatusFilter: string;
  selectedRunId: string | null;
  workflowName: string | null;
};

type DetailPane = "input" | "logs" | "output";

export function ExecutionDebugger({
  defaultPane,
  edges,
  isLoading,
  logLevelFilter,
  logSearch,
  logs,
  nodes,
  onLogLevelFilterChange,
  onLogSearchChange,
  onRefresh,
  onRunStatusFilterChange,
  onSelectRun,
  runDetail,
  runPage,
  runStatusFilter,
  selectedRunId,
  workflowName
}: ExecutionDebuggerProps) {
  const [detailPane, setDetailPane] = useState<DetailPane>(defaultPane);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  const latestStepRuns = useMemo(
    () =>
      latestAttemptByStep(runDetail?.step_runs ?? []).sort(
        (left, right) => left.started_at - right.started_at
      ),
    [runDetail]
  );

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  useEffect(() => {
    setDetailPane(defaultPane);
  }, [defaultPane, selectedRunId]);

  useEffect(() => {
    if (!latestStepRuns.length) {
      setSelectedStepId(null);
      return;
    }

    if (selectedStepId && latestStepRuns.some((stepRun) => stepRun.step_id === selectedStepId)) {
      return;
    }

    const preferredStep =
      latestStepRuns.find((stepRun) =>
        ["failed", "running", "paused"].includes(stepRun.status)
      ) ?? latestStepRuns[latestStepRuns.length - 1];
    setSelectedStepId(preferredStep?.step_id ?? null);
  }, [latestStepRuns, selectedStepId, selectedRunId]);

  const selectedStepRun =
    latestStepRuns.find((stepRun) => stepRun.step_id === selectedStepId) ?? null;
  const selectedStepNode = selectedStepId ? nodeById.get(selectedStepId) ?? null : null;

  const visibleLogs = useMemo(() => {
    if (!logs) {
      return [];
    }
    return logs.logs.filter(
      (log) => !selectedStepId || !log.step_id || log.step_id === selectedStepId
    );
  }, [logs, selectedStepId]);

  const graphNodes = useMemo(
    () =>
      decorateNodesForExecution(nodes, workflowName, runDetail).map((node) => ({
        ...node,
        selected: node.id === selectedStepId
      })),
    [nodes, selectedStepId, runDetail, workflowName]
  );

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <div className="border-b border-black/10 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/60">
              Executions
            </div>
            <div className="mt-1 truncate text-lg font-semibold tracking-tight text-ink">
              {workflowName ?? "Workflow runs"}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-black/10 bg-white/72 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#6f8098]">
              {runPage?.total ?? 0} run{runPage?.total === 1 ? "" : "s"}
            </span>
            <button className="ui-button" disabled={isLoading} onClick={onRefresh} type="button">
              {isLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-black/10 xl:border-b-0 xl:border-r">
          <div className="border-b border-black/10 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/60">
                  Runs
                </div>
                <div className="mt-1 text-sm font-semibold text-ink">
                  {runPage?.total ?? 0} recent execution{runPage?.total === 1 ? "" : "s"}
                </div>
              </div>
              {isLoading ? (
                <span className="rounded-md border border-[#5e86ff]/16 bg-[#eef4ff] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#4b61c8]">
                  syncing
                </span>
              ) : null}
            </div>

            <label className="mt-4 grid gap-2 text-sm text-slate" htmlFor="run-status-filter">
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

          <div className="sleek-scroll min-h-0 space-y-3 overflow-y-auto px-4 py-4">
            {runPage?.runs.map((run) => {
              const active = run.id === selectedRunId;
              return (
                <button
                  key={run.id}
                  className={`w-full rounded-2xl border px-3 py-3 text-left transition ${runCardClassName(run.status, active)}`}
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
                  <div className="mt-3 grid grid-cols-2 gap-2 text-left">
                    <div className="rounded-xl border border-black/8 bg-white/55 px-2.5 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate/55">
                        Started
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate">
                        {formatTimestamp(run.started_at)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-black/8 bg-white/55 px-2.5 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate/55">
                        Duration
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate">
                        {formatDuration(run.duration_seconds)}
                      </div>
                    </div>
                  </div>
                  {run.error_message ? (
                    <div className="mt-3 rounded-xl border border-rose-400/16 bg-rose-400/8 px-2.5 py-2 text-xs leading-5 text-[#c65a72]">
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

        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_500px]">
          {runDetail ? (
            <>
              <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-b border-black/10">
                <div className="border-b border-black/10 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold tracking-tight text-ink">
                        {runDetail.run.workflow_name}
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
                  {runDetail.run.error_message ? (
                    <div className="mt-4 rounded-xl border border-ember/20 bg-[#fff0eb] px-4 py-3 text-sm leading-6 text-[#cd694d]">
                      {runDetail.run.error_message}
                    </div>
                  ) : null}
                </div>

                <div className="min-h-0 p-4">
                  <div className="h-full min-h-0 overflow-hidden rounded-[22px] border border-black/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(246,249,253,0.96))]">
                    <WorkflowCanvas
                      edges={edges}
                      nodes={graphNodes}
                      onAttachStepToTrigger={() => {}}
                      onDeleteStep={() => {}}
                      onEdgesCommit={() => {}}
                      onInsertBetween={() => {}}
                      onPositionsCommit={() => {}}
                      onRequestAddAfterNode={() => {}}
                      onSelectNode={(nodeId) =>
                        setSelectedStepId(nodeId && nodeId !== TRIGGER_NODE_ID ? nodeId : null)
                      }
                      readOnly
                      showControls={false}
                      showMiniMap={false}
                      showViewportPanel={false}
                    />
                  </div>
                </div>
              </section>

              <section className="grid min-h-0 xl:grid-cols-[280px_minmax(0,1fr)]">
                <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-b border-black/10 xl:border-b-0 xl:border-r">
                  <div className="border-b border-black/10 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/60">
                      Steps
                    </div>
                    <div className="mt-1 text-sm font-semibold text-ink">
                      {latestStepRuns.length} step{latestStepRuns.length === 1 ? "" : "s"} in run
                    </div>
                  </div>

                  <div className="sleek-scroll min-h-0 space-y-2 overflow-y-auto px-3 py-3">
                    {latestStepRuns.map((stepRun) => {
                      const active = stepRun.step_id === selectedStepId;
                      const stepLabel = nodeById.get(stepRun.step_id)?.data.label ?? stepRun.step_id;
                      return (
                        <button
                          key={stepRun.id}
                          className={`w-full rounded-2xl border px-3 py-3 text-left transition ${stepRunCardClassName(stepRun.status, active)}`}
                          onClick={() => setSelectedStepId(stepRun.step_id)}
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
                          {stepRun.error_message ? (
                            <div className="mt-3 rounded-xl border border-rose-400/16 bg-rose-400/8 px-2.5 py-2 text-xs leading-5 text-[#c65a72]">
                              {stepRun.error_message}
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </aside>

                <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
                  <div className="border-b border-black/10 bg-[linear-gradient(180deg,rgba(249,251,255,0.96),rgba(244,247,252,0.92))] px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-ink">
                          {selectedStepNode?.data.label ?? selectedStepRun?.step_id ?? "Select a step"}
                        </div>
                        {selectedStepRun ? (
                          <div className="mt-1 truncate text-xs text-slate">
                            {selectedStepRun.step_id} • attempt {selectedStepRun.attempt} • {formatDuration(selectedStepRun.duration_seconds)} • {visibleLogs.length} log{visibleLogs.length === 1 ? "" : "s"}
                          </div>
                        ) : (
                          <div className="mt-1 text-xs text-slate">
                            Select a step to inspect payloads and logs.
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedStepRun ? <RunStatusBadge status={selectedStepRun.status} /> : null}
                        <div className="flex items-center gap-1.5 rounded-2xl border border-[#5e86ff]/12 bg-[#eef3ff] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                      <DetailTab
                        active={detailPane === "input"}
                        label="Input"
                        onClick={() => setDetailPane("input")}
                      />
                      <DetailTab
                        active={detailPane === "output"}
                        label="Output"
                        onClick={() => setDetailPane("output")}
                      />
                      <DetailTab
                        active={detailPane === "logs"}
                        label="Logs"
                        onClick={() => setDetailPane("logs")}
                      />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="sleek-scroll min-h-0 overflow-y-auto px-4 py-4">
                    {selectedStepRun?.error_message ? (
                      <div className="mb-4 rounded-xl border border-rose-400/18 bg-rose-400/8 px-3 py-3 text-sm leading-6 text-[#c65a72]">
                        {selectedStepRun.error_message}
                      </div>
                    ) : null}
                    {detailPane === "logs" ? (
                      <div className="space-y-3">
                        <div className="grid gap-2 md:grid-cols-[140px_minmax(0,1fr)]">
                          <select
                            aria-label="Filter by log level"
                            className="ui-input"
                            onChange={(event) => onLogLevelFilterChange(event.target.value)}
                            value={logLevelFilter}
                          >
                            <option value="">All levels</option>
                            <option value="info">Info</option>
                            <option value="warn">Warn</option>
                            <option value="error">Error</option>
                          </select>
                          <input
                            aria-label="Search log messages"
                            className="ui-input"
                            onChange={(event) => onLogSearchChange(event.target.value)}
                            placeholder="Search log messages"
                            type="text"
                            value={logSearch}
                          />
                        </div>

                        {visibleLogs.length > 0 ? (
                          visibleLogs.map((log) => (
                            <div
                              key={log.id}
                              className={`rounded-2xl border px-4 py-3 text-sm ${
                                log.level === "error"
                                  ? "border-rose-500/20 bg-[#140d12] text-[#f6dde5]"
                                  : log.level === "warn"
                                    ? "border-amber-500/20 bg-[#141109] text-[#f7ead0]"
                                    : "border-[#1a2230] bg-[#0d1118] text-[#dce7f6]"
                              }`}
                            >
                              <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60">
                                <span>{log.level}</span>
                                <span>{formatTimestamp(log.timestamp)}</span>
                                {log.step_id ? <span>{log.step_id}</span> : null}
                              </div>
                              <p className="mt-3 whitespace-pre-wrap font-mono leading-6 text-white/88">
                                {log.message}
                              </p>
                            </div>
                          ))
                        ) : (
                          <EmptyState>
                            No log entries matched the current filters for this run.
                          </EmptyState>
                        )}
                      </div>
                    ) : selectedStepRun ? (
                      <PayloadBox
                        label={detailPane === "input" ? "Input" : "Output"}
                        value={
                          detailPane === "input"
                            ? selectedStepRun.input
                            : selectedStepRun.output
                        }
                      />
                    ) : (
                      <EmptyState>Select a step to inspect its payloads and logs.</EmptyState>
                    )}
                  </div>
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
    </div>
  );
}

function DetailTab({
  active,
  label,
  onClick
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded-xl px-3.5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] transition ${
        active
          ? "bg-[#355cc9] text-white shadow-[0_1px_0_rgba(255,255,255,0.12),0_10px_24px_rgba(53,92,201,0.18)]"
          : "bg-white/82 text-[#4d6199] hover:bg-white"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
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
        ? "border-tide/18 bg-tide/10 text-[#0f7e88]"
        : "border-black/10 bg-white/72 text-[#5d6d85]";

  return (
    <span
      className={`rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${toneClass}`}
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
    case "failed":
      return "failed";
    case "paused":
      return "attention";
    case "running":
      return "running";
    case "skipped":
      return "skipped";
    case "success":
      return "success";
    default:
      return null;
  }
}

function executionMeta(state: NodeExecutionState, stepRun: StepRunView) {
  if (state === "running") {
    return `attempt ${stepRun.attempt}`;
  }

  if (state === "failed" && stepRun.error_message) {
    return "error";
  }

  if (state === "success" && stepRun.duration_seconds !== null && stepRun.duration_seconds !== undefined) {
    return formatDuration(stepRun.duration_seconds);
  }

  return null;
}

function RunStatusBadge({ status }: { status: string }) {
  const tone =
    status === "success"
      ? "border-emerald-400/20 bg-emerald-400/10 text-[#198754]"
      : status === "failed"
        ? "border-rose-400/20 bg-rose-400/10 text-[#d05d78]"
        : status === "paused"
          ? "border-amber-400/20 bg-amber-400/10 text-[#b87a20]"
          : status === "running"
            ? "border-tide/20 bg-tide/10 text-[#117d88]"
            : "border-black/10 bg-white/72 text-[#6f8098]";

  return (
    <span
      className={`rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${tone}`}
    >
      {status}
    </span>
  );
}

function runCardClassName(status: string, active: boolean) {
  if (active) {
    return "border-tide/40 bg-tide/10";
  }

  switch (status) {
    case "success":
      return "border-emerald-400/18 bg-emerald-400/10 hover:border-emerald-400/30";
    case "failed":
      return "border-rose-400/18 bg-rose-400/10 hover:border-rose-400/30";
    case "paused":
      return "border-amber-400/18 bg-amber-400/10 hover:border-amber-400/30";
    case "running":
      return "border-[#7c8fff]/18 bg-[#eef1ff] hover:border-[#7c8fff]/30";
    default:
      return "border-black/10 bg-white/72 hover:border-black/20 hover:bg-white/88";
  }
}

function stepRunCardClassName(status: string, active: boolean) {
  if (active) {
    return "border-[#5e86ff]/36 bg-[#eef1ff]";
  }
  return runCardClassName(status, false);
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-black/10 bg-white/65 px-4 py-8 text-center text-sm leading-6 text-slate">
      {children}
    </div>
  );
}

function PayloadBox({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="h-full rounded-2xl border border-[#1a2230] bg-[#0d1118] p-4 text-white">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
        {label}
      </div>
      <pre className="sleek-scroll mt-3 h-[calc(100%-1.75rem)] overflow-auto whitespace-pre-wrap font-mono text-xs leading-6 text-[#dce7f6]">
        {value ?? "Hidden or unavailable"}
      </pre>
    </div>
  );
}
