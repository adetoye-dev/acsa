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

import type {
  LogPageResponse,
  RunDetailResponse,
  StepRunView
} from "../lib/observability";
import {
  formatDuration,
  formatTimestamp
} from "../lib/observability";
import type { CanvasNode } from "../lib/workflow-editor";

type DetailPane = "input" | "logs" | "output";

type ExecutionInspectorProps = {
  detailPane: DetailPane;
  logLevelFilter: string;
  logSearch: string;
  logs: LogPageResponse | null;
  nodes: CanvasNode[];
  onDetailPaneChange: (value: DetailPane) => void;
  onLogLevelFilterChange: (value: string) => void;
  onLogSearchChange: (value: string) => void;
  runDetail: RunDetailResponse | null;
  selectedStepId: string | null;
};

export function ExecutionInspector({
  detailPane,
  logLevelFilter,
  logSearch,
  logs,
  nodes,
  onDetailPaneChange,
  onLogLevelFilterChange,
  onLogSearchChange,
  runDetail,
  selectedStepId
}: ExecutionInspectorProps) {
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const latestStepRuns = useMemo(
    () => latestAttemptByStep(runDetail?.step_runs ?? []),
    [runDetail]
  );
  const selectedStepRun =
    latestStepRuns.find((stepRun) => stepRun.step_id === selectedStepId) ?? null;
  const selectedStepNode = selectedStepId ? nodeById.get(selectedStepId) ?? null : null;
  const visibleLogs = useMemo(() => {
    if (!logs) {
      return [];
    }
    const normalizedLevelFilter = logLevelFilter.trim().toLowerCase();
    const normalizedSearch = logSearch.trim().toLowerCase();

    return logs.logs.filter((log) => {
      const matchesStep = !selectedStepId || !log.step_id || log.step_id === selectedStepId;
      if (!matchesStep) {
        return false;
      }

      const matchesLevel =
        !normalizedLevelFilter ||
        normalizedLevelFilter === "all" ||
        log.level.toLowerCase() === normalizedLevelFilter;
      if (!matchesLevel) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = [log.message, log.level, log.step_id ?? ""].join(" ").toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [logs, selectedStepId, logLevelFilter, logSearch]);

  if (!runDetail) {
    return (
      <div className="px-4 py-4 text-sm leading-6 text-slate">
        Select a run to inspect execution state, payloads, and logs.
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <section className="border-b border-black/10 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/62">
              Step detail
            </div>
            <div className="mt-1 truncate text-[15px] font-medium tracking-tight text-ink">
              {selectedStepNode?.data.label ?? selectedStepRun?.step_id ?? "No step selected"}
            </div>
            {selectedStepRun ? (
              <div className="mt-1 text-[12px] leading-5 text-slate">
                {selectedStepRun.step_id} • attempt {selectedStepRun.attempt} • {formatDuration(selectedStepRun.duration_seconds)}
              </div>
            ) : (
              <div className="mt-1 text-[12px] leading-5 text-slate">
                Choose a step from the run to inspect its payload and log output.
              </div>
            )}
          </div>
          {selectedStepRun ? (
            <StatusBadge status={selectedStepRun.status} />
          ) : null}
        </div>

        <div className="mt-3 flex items-center gap-1 rounded-[8px] border border-black/10 bg-white p-1">
          <DetailTab
            active={detailPane === "input"}
            label="Input"
            onClick={() => onDetailPaneChange("input")}
          />
          <DetailTab
            active={detailPane === "output"}
            label="Output"
            onClick={() => onDetailPaneChange("output")}
          />
          <DetailTab
            active={detailPane === "logs"}
            label="Logs"
            onClick={() => onDetailPaneChange("logs")}
          />
        </div>
      </section>

      <div className="sleek-scroll min-h-0 overflow-y-auto px-4 py-4">
        {selectedStepRun?.error_message ? (
          <div className="mb-3 rounded-[10px] border border-rose-400/18 bg-rose-50 px-3 py-3 text-sm leading-6 text-[#c65a72]">
            {selectedStepRun.error_message}
          </div>
        ) : null}

        {detailPane === "logs" ? (
          <div className="space-y-3">
            <div className="grid gap-2">
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
                  className={`rounded-[10px] border px-3 py-3 text-sm ${
                    log.level === "error"
                      ? "border-rose-500/20 bg-[#140d12] text-[#f6dde5]"
                      : log.level === "warn"
                        ? "border-amber-500/20 bg-[#141109] text-[#f7ead0]"
                        : "border-[#1a2230] bg-[#0d1118] text-[#dce7f6]"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
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
                No log entries matched the current filters for this step.
              </EmptyState>
            )}
          </div>
        ) : selectedStepRun ? (
          <PayloadBox
            label={detailPane === "input" ? "Input" : "Output"}
            value={detailPane === "input" ? selectedStepRun.input : selectedStepRun.output}
          />
        ) : (
          <EmptyState>Select a step from the run to inspect its payloads and logs.</EmptyState>
        )}
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
      className={`rounded-[8px] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition ${
        active ? "bg-[#171b20] text-white" : "bg-white text-[#66707b] hover:bg-[#f7f7fb]"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
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

function PayloadBox({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="h-full rounded-[12px] border border-[#1a2230] bg-[#0d1118] p-4 text-white">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
        {label}
      </div>
      <pre className="sleek-scroll mt-3 h-[calc(100%-1.75rem)] overflow-auto whitespace-pre-wrap font-mono text-xs leading-6 text-[#dce7f6]">
        {value ?? "Hidden or unavailable"}
      </pre>
    </div>
  );
}

function latestAttemptByStep(stepRuns: StepRunView[]) {
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
  return Array.from(latestByStep.values()).sort(
    (left, right) => (left.started_at ?? 0) - (right.started_at ?? 0)
  );
}
