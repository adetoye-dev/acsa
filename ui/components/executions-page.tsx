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

import { RunGraphPanel } from "./executions-workbench/run-graph-panel";
import { RunListPanel } from "./executions-workbench/run-list-panel";
import { StepDetailRail } from "./executions-workbench/step-detail-rail";
import { StepTimelinePanel } from "./executions-workbench/step-timeline-panel";
import { fetchEngineJson } from "../lib/engine-client";
import {
  type LogPageResponse,
  type RunDetailResponse,
  type RunPageResponse
} from "../lib/observability";
import {
  buildExecutionGraphViewModel,
  type ExecutionDetailPane,
  selectDefaultRun,
  selectDefaultStep
} from "../lib/executions-workbench";
import { type StepTypeEntry } from "../lib/workflow-editor";

type NodeCatalogResponse = {
  step_types: StepTypeEntry[];
};

export function ExecutionsPage() {
  const [detailPane, setDetailPane] = useState<ExecutionDetailPane>("output");
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

  const executionGraphView = useMemo(
    () => buildExecutionGraphViewModel(runDetail, stepCatalog),
    [runDetail, stepCatalog]
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
      <header className="flex h-[60px] items-center justify-between gap-4 border-b border-black/10 bg-white px-6">
        <h1 className="section-title mt-2">Executions</h1>
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
          onRunStatusFilterChange={setRunStatusFilter}
          onSelectRun={handleSelectRun}
          onWorkflowFilterChange={setWorkflowFilter}
          runPage={runPage}
          runStatusFilter={runStatusFilter}
          selectedRunId={selectedRunId}
          workflowFilter={workflowFilter}
        />

        <section className="grid min-h-0 grid-rows-[minmax(260px,0.54fr)_minmax(220px,0.46fr)] border-r border-black/10 bg-white">
          <RunGraphPanel
            graphViewModel={executionGraphView}
            isLoadingRunDetail={selectedRunId !== null && isLoadingRunDetail && !runDetail}
            onSelectStepId={setSelectedStepId}
            runDetail={runDetail}
            selectedRun={selectedRun}
            selectedStepId={selectedStepId}
          />

          <StepTimelinePanel
            isLoading={selectedRunId !== null && isLoadingRunDetail && !runDetail}
            nodeLabels={executionGraphView.nodeLabels}
            onSelectStepId={setSelectedStepId}
            runDetail={runDetail}
            selectedStepId={selectedStepId}
          />
        </section>

        <aside className="min-h-0 overflow-hidden bg-white">
          <div className="sleek-scroll h-full min-h-0 overflow-y-auto">
            <StepDetailRail
              detailPane={detailPane}
              logLevelFilter={logLevelFilter}
              logSearch={logSearch}
              logs={logs}
              nodeLabels={executionGraphView.nodeLabels}
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
