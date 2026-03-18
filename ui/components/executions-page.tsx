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

import { useEffect, useMemo, useState } from "react";

import type { Edge } from "@xyflow/react";

import { decorateNodesForExecution } from "./execution-debugger";
import { ExecutionInspector } from "./execution-inspector";
import { WorkflowCanvas } from "./workflow-canvas";
import { fetchEngineJson } from "../lib/engine-client";
import {
  formatDuration,
  formatTimestamp,
  type LogPageResponse,
  type RunDetailResponse,
  type RunPageResponse,
  type StepRunView
} from "../lib/observability";
import {
  type CanvasNode,
  type StepTypeEntry,
  TRIGGER_NODE_ID,
  type WorkflowDefinition,
  type WorkflowDocumentResponse,
  type WorkflowSummary,
  slugifyIdentifier,
  workflowDocumentFromResponse,
  workflowToCanvas
} from "../lib/workflow-editor";

type DetailPane = "input" | "logs" | "output";

type ExecutionCanvasState = {
  edges: Edge[];
  nodes: CanvasNode[];
};

type NodeCatalogResponse = {
  step_types: StepTypeEntry[];
};

export function ExecutionsPage() {
  const [detailPane, setDetailPane] = useState<DetailPane>("output");
  const [error, setError] = useState<string | null>(null);
  const [isRefreshingRuns, setIsRefreshingRuns] = useState(true);
  const [isLoadingRunDetail, setIsLoadingRunDetail] = useState(false);
  const [logLevelFilter, setLogLevelFilter] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [logs, setLogs] = useState<LogPageResponse | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetailResponse | null>(null);
  const [runPage, setRunPage] = useState<RunPageResponse | null>(null);
  const [runStatusFilter, setRunStatusFilter] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [stepCatalog, setStepCatalog] = useState<StepTypeEntry[]>([]);
  const [workflowFilter, setWorkflowFilter] = useState("");

  const latestStepRuns = useMemo(
    () => latestAttemptByStep(runDetail?.step_runs ?? []).sort((left, right) => left.started_at - right.started_at),
    [runDetail]
  );
  const executionCanvasState = useMemo(
    () => buildExecutionCanvas(runDetail, stepCatalog),
    [runDetail, stepCatalog]
  );
  const nodeLabels = useMemo(
    () =>
      Object.fromEntries(
        (executionCanvasState.canvas?.nodes ?? [])
          .filter((node) => node.data.kind === "step")
          .map((node) => [node.id, node.data.label])
      ),
    [executionCanvasState.canvas]
  );

  useEffect(function refreshRunInventoryEffect() {
    void refreshRunInventory();
  }, [runStatusFilter, workflowFilter]);

  useEffect(function bootstrapExecutionMetadataEffect() {
    let cancelled = false;

    async function loadExecutionMetadata() {
      try {
        const catalogResponse = await fetchEngineJson<NodeCatalogResponse>("/api/node-catalog");

        if (cancelled) {
          return;
        }

        setStepCatalog(catalogResponse.step_types);
      } catch (nextError) {
        if (cancelled) {
          return;
        }
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Failed to load workflow metadata for executions"
        );
      }
    }

    void loadExecutionMetadata();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(function loadSelectedRunDetailEffect() {
    if (!selectedRunId) {
      setRunDetail(null);
      setLogs(null);
      setSelectedStepId(null);
      return;
    }

    let cancelled = false;

    async function loadSelectedRunDetail() {
      setIsLoadingRunDetail(true);
      try {
        const [detailResponse, logResponse] = await Promise.all([
          fetchEngineJson<RunDetailResponse>(`/api/runs/${selectedRunId}`),
          fetchEngineJson<LogPageResponse>(
            `/api/runs/${selectedRunId}/logs?${new URLSearchParams({
              ...(logLevelFilter ? { level: logLevelFilter } : {}),
              ...(logSearch ? { search: logSearch } : {}),
              page: "1",
              page_size: "80"
            }).toString()}`
          )
        ]);

        if (cancelled) {
          return;
        }

        setRunDetail(detailResponse);
        setLogs(logResponse);
        setSelectedStepId((current) => preferredStepId(detailResponse, current));
        setError(null);
      } catch (nextError) {
        if (cancelled) {
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "Failed to load run detail");
      } finally {
        if (!cancelled) {
          setIsLoadingRunDetail(false);
        }
      }
    }

    void loadSelectedRunDetail();

    return () => {
      cancelled = true;
    };
  }, [logLevelFilter, logSearch, selectedRunId]);

  async function refreshRunInventory(preferredRunId?: string | null) {
    setIsRefreshingRuns(true);
    try {
      const query = new URLSearchParams({
        page: "1",
        page_size: "40",
        ...(runStatusFilter ? { status: runStatusFilter } : {}),
        ...(workflowFilter.trim() ? { workflow_name: workflowFilter.trim() } : {})
      });
      const response = await fetchEngineJson<RunPageResponse>(`/api/runs?${query.toString()}`);
      const nextRunId =
        preferredRunId ??
        (selectedRunId ? response.runs.find((run) => run.id === selectedRunId)?.id : undefined) ??
        response.runs[0]?.id ??
        null;
      setRunPage(response);
      setSelectedRunId(nextRunId);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load executions");
    } finally {
      setIsRefreshingRuns(false);
    }
  }

  function handleSelectRun(runId: string) {
    setDetailPane("output");
    setSelectedStepId(null);
    setSelectedRunId(runId);
  }

  const selectedRun = runPage?.runs.find((run) => run.id === selectedRunId) ?? runDetail?.run ?? null;

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <header className="border-b border-black/10 bg-[rgba(255,255,255,0.72)] px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-kicker">Executions</p>
            <h1 className="section-title mt-2">Run history</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate">
              Review workflow runs outside the editor, inspect step payloads, and debug failures
              without pulling the canvas into history mode.
            </p>
          </div>

          <button className="ui-button" onClick={() => void refreshRunInventory(selectedRunId)} type="button">
            {isRefreshingRuns ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      <div className="grid min-h-0 xl:grid-cols-[308px_minmax(0,1fr)_360px]">
        <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-r border-black/10 bg-[rgba(255,255,255,0.42)]">
          <div className="space-y-3 border-b border-black/10 px-4 py-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/62">
              <span className="ui-badge">{runPage?.total ?? 0} runs</span>
            </div>

            <input
              className="ui-input"
              onChange={(event) => setWorkflowFilter(event.target.value)}
              placeholder="Filter by workflow"
              type="text"
              value={workflowFilter}
            />

            <select
              className="ui-input"
              onChange={(event) => setRunStatusFilter(event.target.value)}
              value={runStatusFilter}
            >
              <option value="">All statuses</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
              <option value="paused">Paused</option>
              <option value="running">Running</option>
            </select>
          </div>

          <div className="sleek-scroll min-h-0 overflow-y-auto px-3 py-3">
            {error ? (
              <div className="rounded-[12px] border border-rose-400/20 bg-rose-50 px-4 py-3 text-sm leading-6 text-[#c65a72]">
                {error}
              </div>
            ) : null}

            {isRefreshingRuns && !runPage ? (
              <PageEmptyState>Loading executions…</PageEmptyState>
            ) : runPage?.runs.length ? (
              <div className="space-y-2">
                {runPage.runs.map((run) => {
                  const active = run.id === selectedRunId;
                  return (
                    <button
                      key={run.id}
                      className={`w-full rounded-[12px] border px-3.5 py-2.5 text-left transition ${
                        active
                          ? "border-black/12 bg-white text-ink"
                          : "border-black/8 bg-white/70 text-ink hover:border-black/12 hover:bg-white"
                      }`}
                      onClick={() => handleSelectRun(run.id)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-ink">
                            {run.workflow_name}
                          </div>
                          <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-slate/62">
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
                        <div className="mt-1 line-clamp-2 text-xs leading-5 text-[#c65a72]">
                          {run.error_message}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <PageEmptyState>No executions matched the current filters.</PageEmptyState>
            )}
          </div>
        </aside>

        <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-r border-black/10 bg-[rgba(255,255,255,0.6)]">
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
                    : "Choose a run from the left rail to inspect its steps."}
                </div>
              </div>
              {selectedRun ? <RunStatusBadge status={selectedRun.status} /> : null}
            </div>

            {selectedRun ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-slate/62">
                <span className="ui-badge">{formatDuration(selectedRun.duration_seconds)}</span>
                <span className="ui-badge">{latestStepRuns.length} steps</span>
                <span className="ui-badge">{runDetail?.human_tasks.length ?? 0} tasks</span>
              </div>
            ) : null}

            {runDetail?.run.error_message ? (
              <div className="mt-3 rounded-[12px] border border-rose-400/20 bg-rose-50 px-4 py-3 text-sm leading-6 text-[#c65a72]">
                {runDetail.run.error_message}
              </div>
            ) : null}
          </div>

          <div className="grid min-h-0 grid-rows-[minmax(260px,0.54fr)_minmax(220px,0.46fr)]">
            <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-b border-black/10">
              <div className="border-b border-black/10 px-5 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/60">
                  Run graph
                </div>
              </div>

              <div className="min-h-0 overflow-hidden bg-[#fbfbfc]">
                {selectedRunId && isLoadingRunDetail && !runDetail ? (
                  <PageEmptyState>Loading run detail…</PageEmptyState>
                ) : executionCanvasState.canvas ? (
                  <WorkflowCanvas
                    key={`executions-${selectedRunId ?? "empty"}`}
                    edges={executionCanvasState.canvas.edges}
                    frameRequestKey={runDetail?.run.started_at ?? 0}
                    nodes={executionCanvasState.canvas.nodes.map((node) => ({
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
                      setSelectedStepId(nodeId && nodeId !== TRIGGER_NODE_ID ? nodeId : null)
                    }
                    readOnly
                    showControls={false}
                    showMiniMap={false}
                    showViewportPanel={false}
                  />
                ) : executionCanvasState.error ? (
                  <PageEmptyState>{executionCanvasState.error}</PageEmptyState>
                ) : (
                  <PageEmptyState>
                    {selectedRun
                      ? "The workflow graph is unavailable for this run."
                      : "Select a run to inspect its graph."}
                  </PageEmptyState>
                )}
              </div>
            </div>

            <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <div className="border-b border-black/10 px-5 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/60">
                  Step timeline
                </div>
              </div>

              <div className="sleek-scroll min-h-0 overflow-y-auto px-4 py-4">
                {selectedRunId && isLoadingRunDetail && !runDetail ? (
                  <PageEmptyState>Loading run detail…</PageEmptyState>
                ) : latestStepRuns.length ? (
                  <div className="space-y-2">
                    {latestStepRuns.map((stepRun) => {
                      const active = stepRun.step_id === selectedStepId;
                      return (
                        <button
                          key={stepRun.id}
                          className={`w-full rounded-[12px] border px-3.5 py-3 text-left transition ${
                            active
                              ? "border-black/12 bg-white text-ink"
                              : "border-black/8 bg-white/72 text-ink hover:border-black/12 hover:bg-white"
                          }`}
                          onClick={() => setSelectedStepId(stepRun.step_id)}
                          type="button"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-ink">
                                {nodeLabels[stepRun.step_id] ?? stepRun.step_id}
                              </div>
                              <div className="mt-1 text-xs text-slate">
                                attempt {stepRun.attempt} • {formatDuration(stepRun.duration_seconds)}
                              </div>
                            </div>
                            <RunStatusBadge status={stepRun.status} />
                          </div>
                          {stepRun.error_message ? (
                            <div className="mt-2 line-clamp-2 text-xs leading-5 text-[#c65a72]">
                              {stepRun.error_message}
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <PageEmptyState>
                    {selectedRun
                      ? "This run has no recorded step attempts yet."
                      : "Select a run to inspect its step timeline."}
                  </PageEmptyState>
                )}
              </div>
            </div>
          </div>
        </section>

        <aside className="min-h-0 overflow-hidden bg-[rgba(255,255,255,0.72)]">
          <div className="sleek-scroll h-full min-h-0 overflow-y-auto">
            <ExecutionInspector
              detailPane={detailPane}
              logLevelFilter={logLevelFilter}
              logSearch={logSearch}
              logs={logs}
              nodeLabels={nodeLabels}
              onDetailPaneChange={setDetailPane}
              onLogLevelFilterChange={setLogLevelFilter}
              onLogSearchChange={setLogSearch}
              runDetail={runDetail}
              selectedStepId={selectedStepId}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function latestAttemptByStep(stepRuns: StepRunView[]) {
  const byStep = new Map<string, StepRunView>();
  for (const stepRun of stepRuns) {
    const existing = byStep.get(stepRun.step_id);
    if (!existing || stepRun.attempt >= existing.attempt) {
      byStep.set(stepRun.step_id, stepRun);
    }
  }
  return Array.from(byStep.values());
}

function preferredStepId(runDetail: RunDetailResponse, currentStepId: string | null) {
  const stepRuns = latestAttemptByStep(runDetail.step_runs).sort(
    (left, right) => left.started_at - right.started_at
  );
  if (currentStepId && stepRuns.some((stepRun) => stepRun.step_id === currentStepId)) {
    return currentStepId;
  }
  return stepRuns.find((stepRun) => stepRun.status === "failed")?.step_id ?? stepRuns[0]?.step_id ?? null;
}

function buildExecutionCanvas(
  runDetail: RunDetailResponse | null,
  stepCatalog: StepTypeEntry[]
): { canvas: ExecutionCanvasState | null; error: string | null } {
  if (!runDetail) {
    return { canvas: null, error: null };
  }

  try {
    if (runDetail.editor_snapshot?.trim()) {
      const workflowId = slugifyIdentifier(runDetail.run.workflow_name);
      const fallbackSummary = buildSnapshotSummary(workflowId, runDetail.run.workflow_name);
      const response: WorkflowDocumentResponse = {
        id: workflowId,
        summary: fallbackSummary,
        yaml: runDetail.editor_snapshot
      };
      const document = workflowDocumentFromResponse(response);
      const nextCanvas = workflowToCanvas(document.workflow, document.positions, stepCatalog);
      return {
        canvas: {
          edges: nextCanvas.edges,
          nodes: decorateNodesForExecution(
            nextCanvas.nodes,
            document.workflow.name,
            runDetail
          )
        },
        error: null
      };
    }

    if (runDetail.workflow_snapshot?.trim()) {
      const workflow = JSON.parse(runDetail.workflow_snapshot) as WorkflowDefinition;
      const nextCanvas = workflowToCanvas(workflow, workflow.ui?.positions ?? {}, stepCatalog);
      return {
        canvas: {
          edges: nextCanvas.edges,
          nodes: decorateNodesForExecution(
            nextCanvas.nodes,
            workflow.name,
            runDetail
          )
        },
        error: null
      };
    }

    return {
      canvas: null,
      error: "This run does not include a workflow snapshot."
    };
  } catch (error) {
    return {
      canvas: null,
      error: error instanceof Error ? error.message : "Failed to build execution graph"
    };
  }
}

function buildSnapshotSummary(
  workflowId: string,
  workflowName: string
): WorkflowSummary {
  return {
    description: workflowName,
    file_name: `${workflowId}.yaml`,
    has_connector_steps: false,
    id: workflowId,
    name: workflowName,
    step_count: 0,
    trigger_type: "manual"
  };
}

function RunStatusBadge({ status }: { status: string }) {
  const className =
    status === "success"
      ? "border-emerald-400/18 bg-emerald-50 text-[#2e7b54]"
      : status === "failed"
        ? "border-rose-400/18 bg-rose-50 text-[#c65a72]"
        : status === "paused"
          ? "border-amber-400/18 bg-amber-50 text-[#a76825]"
          : "border-black/10 bg-white text-slate";

  return (
    <span className={`rounded-[8px] border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${className}`}>
      {status}
    </span>
  );
}

function PageEmptyState({ children }: { children: string }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-[12px] border border-dashed border-black/10 bg-white/72 px-6 text-center text-sm leading-6 text-slate">
      {children}
    </div>
  );
}
