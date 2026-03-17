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

import type { ReactNode } from "react";

import {
  formatDuration,
  formatTimestamp,
  type LogPageResponse,
  type MetricsSummary,
  type RunDetailResponse,
  type RunPageResponse
} from "../lib/observability";

type RunHistoryPanelProps = {
  embedded?: boolean;
  isLoading: boolean;
  logLevelFilter: string;
  logSearch: string;
  logs: LogPageResponse | null;
  metrics: MetricsSummary | null;
  onLogLevelFilterChange: (value: string) => void;
  onLogSearchChange: (value: string) => void;
  onRefresh: () => void;
  onRunStatusFilterChange: (value: string) => void;
  onSelectRun: (runId: string) => void;
  runDetail: RunDetailResponse | null;
  runPage: RunPageResponse | null;
  runStatusFilter: string;
  selectedRunId: string | null;
  view: "history" | "logs";
  workflowName: string | null;
};

export function RunHistoryPanel({
  embedded = false,
  isLoading,
  logLevelFilter,
  logSearch,
  logs,
  metrics,
  onLogLevelFilterChange,
  onLogSearchChange,
  onRefresh,
  onRunStatusFilterChange,
  onSelectRun,
  runDetail,
  runPage,
  runStatusFilter,
  selectedRunId,
  view,
  workflowName
}: RunHistoryPanelProps) {
  const title = view === "history" ? "Run history" : "Workflow logs";
  const subtitle =
    view === "history"
      ? "Execution detail for the active workflow"
      : "Structured log stream for the selected run";

  const body = (
    <div className="grid min-h-0 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-b border-black/10 xl:border-b-0 xl:border-r">
        <div className="border-b border-black/10 px-4 py-4">
          <label className="grid gap-2 text-sm text-slate" htmlFor="run-status-filter">
            Run status
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
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-semibold text-ink">
                    {run.workflow_name}
                  </div>
                  <RunStatusBadge status={run.status} />
                </div>
                <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-slate/65">
                  {run.id.slice(0, 8)}
                </div>
                <div className="mt-2 text-sm text-slate">
                  Started {formatTimestamp(run.started_at)}
                </div>
                <div className="ui-meta mt-1">
                  Duration {formatDuration(run.duration_seconds)}
                </div>
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

      <div className="min-h-0">
        {runDetail ? (
          view === "history" ? (
            <HistoryDetail runDetail={runDetail} />
          ) : (
            <LogDetail
              logLevelFilter={logLevelFilter}
              logSearch={logSearch}
              logs={logs}
              onLogLevelFilterChange={onLogLevelFilterChange}
              onLogSearchChange={onLogSearchChange}
              runDetail={runDetail}
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center px-8">
            <EmptyState>
              Select a run to inspect timeline details and structured logs.
            </EmptyState>
          </div>
        )}
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <div className="border-b border-black/10 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate">{subtitle}</div>
            <div className="flex flex-wrap items-center gap-2">
              {workflowName ? (
                <span className="rounded-md border border-[#f0a15e]/18 bg-[#fff2e7] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#c06e29]">
              {workflowName}
                </span>
              ) : null}
              <span className="rounded-md border border-black/10 bg-white/72 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#6f8098]">
                {runPage?.total ?? 0} run{runPage?.total === 1 ? "" : "s"}
              </span>
              <button className="ui-button" disabled={isLoading} onClick={onRefresh} type="button">
                {isLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          {view === "history" ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
              <MetricCard
                label="Workflow runs"
                note={`${metrics?.workflowRunsSuccess ?? 0} succeeded`}
                tone="violet"
                value={metrics?.workflowRunsTotal ?? 0}
              />
              <MetricCard
                label="Paused runs"
                note={`${metrics?.workflowRunsFailed ?? 0} failed`}
                tone="amber"
                value={metrics?.workflowRunsPaused ?? 0}
              />
              <MetricCard
                label="Step attempts"
                note={`${metrics?.stepRetries ?? 0} retries`}
                tone="teal"
                value={metrics?.stepExecutions ?? 0}
              />
              <MetricCard
                label="Average run time"
                note={`${metrics?.stepFailures ?? 0} step failures`}
                tone="rose"
                value={formatDuration(Math.round(metrics?.workflowAverageDurationSeconds ?? 0))}
              />
            </div>
          ) : null}
        </div>
        {body}
      </div>
    );
  }

  return (
    <section className="panel-surface grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <div className="border-b border-black/10 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="section-kicker">Observability</p>
            <h2 className="section-title mt-1">{title}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {workflowName ? (
              <span className="rounded-md border border-[#f0a15e]/18 bg-[#fff2e7] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#c06e29]">
              {workflowName}
              </span>
            ) : null}
            <span className="rounded-md border border-black/10 bg-white/72 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#6f8098]">
              {runPage?.total ?? 0} run{runPage?.total === 1 ? "" : "s"}
            </span>
            <button className="ui-button" disabled={isLoading} onClick={onRefresh} type="button">
              {isLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate">{subtitle}</p>

        {view === "history" ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
            <MetricCard
              label="Workflow runs"
              note={`${metrics?.workflowRunsSuccess ?? 0} succeeded`}
              tone="violet"
              value={metrics?.workflowRunsTotal ?? 0}
            />
            <MetricCard
              label="Paused runs"
              note={`${metrics?.workflowRunsFailed ?? 0} failed`}
              tone="amber"
              value={metrics?.workflowRunsPaused ?? 0}
            />
            <MetricCard
              label="Step attempts"
              note={`${metrics?.stepRetries ?? 0} retries`}
              tone="teal"
              value={metrics?.stepExecutions ?? 0}
            />
            <MetricCard
              label="Average run time"
              note={`${metrics?.stepFailures ?? 0} step failures`}
              tone="rose"
              value={formatDuration(Math.round(metrics?.workflowAverageDurationSeconds ?? 0))}
            />
          </div>
        ) : null}
      </div>

      {body}
    </section>
  );
}

function HistoryDetail({ runDetail }: { runDetail: RunDetailResponse }) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <section className="border-b border-black/10 px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="section-kicker">Selected run</p>
            <h3 className="mt-1 text-lg font-semibold tracking-tight text-ink">
              {runDetail.run.workflow_name}
            </h3>
          </div>
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate/65">
            <div>{runDetail.run.id}</div>
            <div>{formatTimestamp(runDetail.run.started_at)}</div>
          </div>
        </div>
        {runDetail.run.error_message ? (
          <div className="mt-4 rounded-xl border border-ember/20 bg-[#fff0eb] px-4 py-3 text-sm leading-6 text-[#cd694d]">
            {runDetail.run.error_message}
          </div>
        ) : null}
      </section>

      <div className="sleek-scroll min-h-0 space-y-4 overflow-y-auto px-4 py-4">
        {runDetail.step_runs.map((stepRun) => (
          <article key={stepRun.id} className="ui-panel-card p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h4 className="text-base font-semibold text-ink">{stepRun.step_id}</h4>
                <div className="ui-meta mt-1">
                  attempt {stepRun.attempt} • {stepRun.status}
                </div>
              </div>
              <div className="font-mono text-sm text-slate">
                {formatDuration(stepRun.duration_seconds)}
              </div>
            </div>

            {stepRun.error_message ? (
              <div className="mt-4 rounded-xl border border-ember/20 bg-[#fff0eb] px-4 py-3 text-sm leading-6 text-[#cd694d]">
                {stepRun.error_message}
              </div>
            ) : null}

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <PayloadBox label="Input" value={stepRun.input} />
              <PayloadBox label="Output" value={stepRun.output} />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function LogDetail({
  logLevelFilter,
  logSearch,
  logs,
  onLogLevelFilterChange,
  onLogSearchChange,
  runDetail
}: {
  logLevelFilter: string;
  logSearch: string;
  logs: LogPageResponse | null;
  onLogLevelFilterChange: (value: string) => void;
  onLogSearchChange: (value: string) => void;
  runDetail: RunDetailResponse;
}) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <section className="border-b border-black/10 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="section-kicker">Selected run</p>
            <h3 className="mt-1 text-lg font-semibold tracking-tight text-ink">
              {runDetail.run.id.slice(0, 8)} • {runDetail.run.status}
            </h3>
          </div>
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate/65">
            {formatTimestamp(runDetail.run.started_at)}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
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
      </section>

      <div className="sleek-scroll min-h-0 space-y-3 overflow-y-auto px-4 py-4">
        {logs?.logs.map((log) => (
          <div
            key={log.id}
            className="rounded-2xl border border-[#1a2230] bg-[#0d1118] px-4 py-3 text-sm text-mist"
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
        ))}

        {!logs?.logs.length ? (
          <EmptyState>No log entries matched the current filters for this run.</EmptyState>
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-black/10 bg-white/65 px-4 py-8 text-center text-sm leading-6 text-slate">
      {children}
    </div>
  );
}

function MetricCard({
  label,
  note,
  tone,
  value
}: {
  label: string;
  note: string;
  tone: "amber" | "rose" | "teal" | "violet";
  value: number | string;
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-400/18 bg-amber-400/10"
      : tone === "rose"
        ? "border-rose-400/18 bg-rose-400/10"
        : tone === "teal"
          ? "border-tide/18 bg-tide/10"
          : "border-[#7c8fff]/18 bg-[#7c8fff]/10";

  return (
    <article className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/65">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-ink">{value}</div>
      <div className="mt-1 text-sm text-slate">{note}</div>
    </article>
  );
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

function PayloadBox({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-2xl border border-[#1a2230] bg-[#0d1118] p-4 text-white">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
        {label}
      </div>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-6 text-mist">
        {value ?? "Hidden or unavailable"}
      </pre>
    </div>
  );
}
