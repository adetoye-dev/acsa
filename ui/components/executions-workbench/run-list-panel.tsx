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

import {
  formatDuration,
  formatTimestamp,
  runProvenanceLabel,
  runProvenanceTone,
  type RunPageResponse
} from "../../lib/observability";
import { sortRunsNewestFirst } from "../../lib/executions-workbench";

type RunListPanelProps = {
  error: string | null;
  isRefreshingRuns: boolean;
  onRefresh: () => void;
  onRunStatusFilterChange: (value: string) => void;
  onSelectRun: (runId: string) => void;
  onWorkflowFilterChange: (value: string) => void;
  runPage: RunPageResponse | null;
  runStatusFilter: string;
  selectedRunId: string | null;
  workflowFilter: string;
};

export function RunListPanel({
  error,
  isRefreshingRuns,
  onRefresh,
  onRunStatusFilterChange,
  onSelectRun,
  onWorkflowFilterChange,
  runPage,
  runStatusFilter,
  selectedRunId,
  workflowFilter
}: RunListPanelProps) {
  const sortedRuns = sortRunsNewestFirst(runPage?.runs ?? []);

  return (
    <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-r border-black/10 bg-[rgba(255,255,255,0.42)]">
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
          <button className="ui-button" disabled={isRefreshingRuns} onClick={onRefresh} type="button">
            {isRefreshingRuns ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="border-b border-black/10 px-4 py-3.5">
        <label className="grid gap-2 text-sm text-slate" htmlFor="workflow-filter">
          Workflow
          <input
            className="ui-input"
            id="workflow-filter"
            onChange={(event) => onWorkflowFilterChange(event.target.value)}
            placeholder="Filter by workflow"
            type="text"
            value={workflowFilter}
          />
        </label>

        <label className="mt-3 grid gap-2 text-sm text-slate" htmlFor="run-status-filter">
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

      <div className="sleek-scroll min-h-0 overflow-y-auto px-3 py-3">
        {error ? (
          <div className="rounded-[12px] border border-rose-400/20 bg-rose-50 px-4 py-3 text-sm leading-6 text-[#c65a72]">
            {error}
          </div>
        ) : null}

        {isRefreshingRuns && !runPage ? (
          <PageEmptyState>Loading executions…</PageEmptyState>
        ) : sortedRuns.length ? (
          <div className="space-y-2">
            {sortedRuns.map((run) => {
              const active = run.id === selectedRunId;
              return (
                <button
                  key={run.id}
                  className={`w-full rounded-[12px] border px-3.5 py-2.5 text-left transition ${
                    active
                      ? "border-black/12 bg-white text-ink"
                      : "border-black/8 bg-white/70 text-ink hover:border-black/12 hover:bg-white"
                  }`}
                  onClick={() => onSelectRun(run.id)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink">{run.workflow_name}</div>
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
                    <span className="text-slate/35">•</span>
                    <span
                      className={`rounded-[8px] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${runProvenanceTone(run)}`}
                    >
                      {runProvenanceLabel(run)}
                    </span>
                  </div>
                  {run.error_message ? (
                    <div className="mt-2 line-clamp-2 text-xs leading-5 text-[#c65a72]">
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

function PageEmptyState({ children }: { children: string }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-[12px] border border-dashed border-black/10 bg-white/72 px-6 text-center text-sm leading-6 text-slate">
      {children}
    </div>
  );
}
