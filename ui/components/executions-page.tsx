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
import YAML from "yaml";

import { decorateNodesForExecution } from "./execution-debugger";
import { ExecutionInspector } from "./execution-inspector";
import { RunListPanel } from "./executions-workbench/run-list-panel";
import { WorkflowCanvas } from "./workflow-canvas";
import { fetchEngineJson } from "../lib/engine-client";
import {
  formatDuration,
  formatTimestamp,
  type LogPageResponse,
  type RunDetailResponse,
  type RunPageResponse,
  runProvenanceLabel,
  runProvenanceTone
} from "../lib/observability";
import {
  selectDefaultRun,
  selectDefaultStep,
  latestStepRunsByStep
} from "../lib/executions-workbench";
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
    () => latestStepRunsByStep(runDetail?.step_runs ?? []),
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
        setSelectedStepId((current) => selectDefaultStep(detailResponse, current));
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
      const nextRunId = selectDefaultRun(response, selectedRunId, preferredRunId);
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
      <header className="flex h-[60px] items-center justify-between gap-4 border-b border-black/10 bg-[rgba(255,255,255,0.72)] px-6">
        <h1 className="section-title mt-2">Run history</h1>
        <button
          className="ui-button"
          onClick={() => void refreshRunInventory(selectedRunId)}
          type="button"
        >
          {isRefreshingRuns ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      <div className="grid min-h-0 xl:grid-cols-[308px_minmax(0,1fr)_360px]">
        <RunListPanel
          error={error}
          isRefreshingRuns={isRefreshingRuns}
          onRefresh={() => void refreshRunInventory(selectedRunId)}
          onRunStatusFilterChange={setRunStatusFilter}
          onSelectRun={handleSelectRun}
          onWorkflowFilterChange={setWorkflowFilter}
          runPage={runPage}
          runStatusFilter={runStatusFilter}
          selectedRunId={selectedRunId}
          workflowFilter={workflowFilter}
        />

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
                <span
                  className={`rounded-[8px] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${runProvenanceTone(selectedRun)}`}
                >
                  {runProvenanceLabel(selectedRun)}
                </span>
                {selectedRun.workflow_revision ? (
                  <span className="ui-badge font-mono">{selectedRun.workflow_revision}</span>
                ) : null}
              </div>
            ) : null}

            {selectedRun ? (
              <div className="mt-3 text-sm leading-6 text-slate">
                {selectedRun.run_provenance.message}
                {selectedRun.run_provenance.fallback_message ? (
                  <span className="block text-[#a76825]">
                    {selectedRun.run_provenance.fallback_message}
                  </span>
                ) : null}
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

function buildExecutionCanvas(
  runDetail: RunDetailResponse | null,
  stepCatalog: StepTypeEntry[]
): { canvas: ExecutionCanvasState | null; error: string | null } {
  if (!runDetail) {
    return { canvas: null, error: null };
  }

  try {
    if (runDetail.workflow_snapshot?.trim()) {
      const workflowId = slugifyIdentifier(runDetail.run.workflow_name);
      const fallbackSummary = buildSnapshotSummary(workflowId, runDetail.run.workflow_name);
      const storedPositions = extractEditorSnapshotPositions(runDetail.editor_snapshot);
      let document: ReturnType<typeof workflowDocumentFromResponse>;

      try {
        const response: WorkflowDocumentResponse = {
          id: workflowId,
          summary: fallbackSummary,
          yaml: runDetail.workflow_snapshot
        };
        document = workflowDocumentFromResponse(response, undefined, storedPositions);
      } catch {
        const workflow = JSON.parse(runDetail.workflow_snapshot) as WorkflowDefinition;
        const nextCanvas = workflowToCanvas(
          workflow,
          {
            ...(workflow.ui?.positions ?? {}),
            ...(storedPositions ?? {})
          },
          stepCatalog
        );
        return {
          canvas: {
            edges: nextCanvas.edges,
            nodes: decorateNodesForExecution(nextCanvas.nodes, workflow.name, runDetail)
          },
          error: null
        };
      }

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
    trigger_type: "manual",
    workflow_state: {
      lifecycle: "saved",
      readiness: {
        connector_requirements: {
          required_step_types: []
        },
        readiness_state: "ready",
        validation_state: "valid"
      },
      telemetry: {
        last_run_at: null,
        last_run_status: null
      }
    }
  };
}

function extractEditorSnapshotPositions(
  editorSnapshot?: string | null
): Record<string, { x: number; y: number }> | undefined {
  if (!editorSnapshot?.trim()) {
    return undefined;
  }

  try {
    const document = YAML.parse(editorSnapshot) as
      | { ui?: { positions?: Record<string, unknown> } }
      | null;
    const positionsValue = document?.ui?.positions;

    if (
      !positionsValue ||
      typeof positionsValue !== "object" ||
      Array.isArray(positionsValue)
    ) {
      return undefined;
    }

    const positions = Object.fromEntries(
      Object.entries(positionsValue).flatMap(([nodeId, positionValue]) => {
        if (
          !positionValue ||
          typeof positionValue !== "object" ||
          Array.isArray(positionValue)
        ) {
          return [];
        }

        const x = (positionValue as { x?: unknown }).x;
        const y = (positionValue as { y?: unknown }).y;

        if (typeof x !== "number" || typeof y !== "number") {
          return [];
        }

        return [[nodeId, { x, y }] as const];
      })
    );

    return positions;
  } catch {
    return undefined;
  }
}

function PageEmptyState({ children }: { children: string }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-[12px] border border-dashed border-black/10 bg-white/72 px-6 text-center text-sm leading-6 text-slate">
      {children}
    </div>
  );
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
    <span
      className={`rounded-[8px] border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${className}`}
    >
      {status}
    </span>
  );
}
