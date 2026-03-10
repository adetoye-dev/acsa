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
  type LogPageResponse,
  type MetricsSummary,
  type RunDetailResponse,
  type RunPageResponse
} from "../lib/observability";

type RunHistoryPanelProps = {
  isLoading: boolean;
  logLevelFilter: string;
  logSearch: string;
  logs: LogPageResponse | null;
  metrics: MetricsSummary | null;
  onLogLevelFilterChange: (value: string) => void;
  onLogSearchChange: (value: string) => void;
  onRefresh: () => void;
  onRunStatusFilterChange: (value: string) => void;
  onRunWorkflowFilterChange: (value: string) => void;
  onSelectRun: (runId: string) => void;
  runDetail: RunDetailResponse | null;
  runPage: RunPageResponse | null;
  runStatusFilter: string;
  runWorkflowFilter: string;
  selectedRunId: string | null;
};

export function RunHistoryPanel({
  isLoading,
  logLevelFilter,
  logSearch,
  logs,
  metrics,
  onLogLevelFilterChange,
  onLogSearchChange,
  onRefresh,
  onRunStatusFilterChange,
  onRunWorkflowFilterChange,
  onSelectRun,
  runDetail,
  runPage,
  runStatusFilter,
  runWorkflowFilter,
  selectedRunId
}: RunHistoryPanelProps) {
  return (
    <section className="panel-surface overflow-hidden">
      <div className="border-b border-black/10 px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="section-kicker">Observability</p>
            <h2 className="section-title mt-2">Run history, logs, and metrics</h2>
          </div>
          <button
            className="rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:border-ink/20 hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isLoading}
            onClick={onRefresh}
            type="button"
          >
            {isLoading ? "Refreshing..." : "Refresh history"}
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Workflow runs"
            value={metrics?.workflowRunsTotal ?? 0}
            note={`${metrics?.workflowRunsSuccess ?? 0} succeeded`}
          />
          <MetricCard
            label="Paused runs"
            value={metrics?.workflowRunsPaused ?? 0}
            note={`${metrics?.workflowRunsFailed ?? 0} failed`}
          />
          <MetricCard
            label="Step attempts"
            value={metrics?.stepExecutions ?? 0}
            note={`${metrics?.stepRetries ?? 0} retries`}
          />
          <MetricCard
            label="Average run time"
            value={formatDuration(
              Math.round(metrics?.workflowAverageDurationSeconds ?? 0)
            )}
            note={`${metrics?.stepFailures ?? 0} step failures`}
          />
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="border-b border-black/10 xl:border-b-0 xl:border-r">
          <div className="space-y-4 px-5 py-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
              <input
                className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-tide/40"
                onChange={(event) => onRunWorkflowFilterChange(event.target.value)}
                placeholder="Filter by workflow"
                type="text"
                value={runWorkflowFilter}
              />
              <select
                className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-tide/40"
                onChange={(event) => onRunStatusFilterChange(event.target.value)}
                value={runStatusFilter}
              >
                <option value="">All statuses</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
                <option value="paused">Paused</option>
                <option value="running">Running</option>
              </select>
            </div>

            <div className="space-y-3">
              {runPage?.runs.map((run) => {
                const active = run.id === selectedRunId;
                return (
                  <button
                    key={run.id}
                    className={`w-full rounded-3xl border px-4 py-4 text-left transition ${
                      active
                        ? "border-tide/40 bg-tide/10 shadow-panel"
                        : "border-black/10 bg-white/70 hover:border-black/20 hover:bg-white"
                    }`}
                    onClick={() => onSelectRun(run.id)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-display text-lg font-semibold text-ink">
                        {run.workflow_name}
                      </span>
                      <span className="rounded-full bg-sand px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ember">
                        {run.status}
                      </span>
                    </div>
                    <div className="mt-3 text-sm leading-6 text-slate">
                      {run.id}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate">
                      Started {formatTimestamp(run.started_at)}
                    </div>
                    <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate/65">
                      Duration {formatDuration(run.duration_seconds)}
                    </div>
                  </button>
                );
              })}
              {!runPage?.runs.length ? (
                <div className="rounded-3xl border border-dashed border-black/15 bg-white/60 px-4 py-8 text-center text-sm leading-6 text-slate">
                  No runs match the current filters yet.
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-5 px-5 py-5">
          {runDetail ? (
            <>
              <section className="rounded-3xl border border-black/10 bg-white/70 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="section-kicker">Run detail</p>
                    <h3 className="mt-2 font-display text-2xl text-ink">
                      {runDetail.run.workflow_name}
                    </h3>
                  </div>
                  <div className="text-sm leading-6 text-slate">
                    <div>{runDetail.run.id}</div>
                    <div>{formatTimestamp(runDetail.run.started_at)}</div>
                  </div>
                </div>
                {runDetail.run.error_message ? (
                  <div className="mt-4 rounded-2xl border border-ember/20 bg-ember/5 px-4 py-3 text-sm leading-6 text-ember">
                    {runDetail.run.error_message}
                  </div>
                ) : null}
              </section>

              <section className="rounded-3xl border border-black/10 bg-white/70 p-4">
                <p className="section-kicker">Timeline</p>
                <div className="mt-4 space-y-4">
                  {runDetail.step_runs.map((stepRun) => (
                    <article
                      key={stepRun.id}
                      className="rounded-3xl border border-black/10 bg-white p-4"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <h4 className="font-display text-xl text-ink">
                            {stepRun.step_id}
                          </h4>
                          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate/65">
                            attempt {stepRun.attempt} • {stepRun.status}
                          </div>
                        </div>
                        <div className="text-sm leading-6 text-slate">
                          {formatDuration(stepRun.duration_seconds)}
                        </div>
                      </div>

                      {stepRun.error_message ? (
                        <div className="mt-4 rounded-2xl border border-ember/20 bg-ember/5 px-4 py-3 text-sm leading-6 text-ember">
                          {stepRun.error_message}
                        </div>
                      ) : null}

                      <div className="mt-4 grid gap-4 lg:grid-cols-2">
                        <PayloadBox label="Input" value={stepRun.input} />
                        <PayloadBox label="Output" value={stepRun.output} />
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-black/10 bg-white/70 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <p className="section-kicker">Logs</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <select
                      className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-tide/40"
                      onChange={(event) => onLogLevelFilterChange(event.target.value)}
                      value={logLevelFilter}
                    >
                      <option value="">All levels</option>
                      <option value="info">Info</option>
                      <option value="warn">Warn</option>
                      <option value="error">Error</option>
                    </select>
                    <input
                      className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-tide/40"
                      onChange={(event) => onLogSearchChange(event.target.value)}
                      placeholder="Search logs"
                      type="text"
                      value={logSearch}
                    />
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {logs?.logs.map((log) => (
                    <div
                      key={log.id}
                      className="rounded-2xl border border-black/10 bg-ink px-4 py-3 text-sm text-mist"
                    >
                      <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/65">
                        <span>{log.level}</span>
                        <span>{formatTimestamp(log.timestamp)}</span>
                        {log.step_id ? <span>{log.step_id}</span> : null}
                      </div>
                      <p className="mt-3 whitespace-pre-wrap leading-6">{log.message}</p>
                    </div>
                  ))}
                  {!logs?.logs.length ? (
                    <div className="rounded-3xl border border-dashed border-black/15 bg-white/60 px-4 py-8 text-center text-sm leading-6 text-slate">
                      No log entries match the current filters for this run.
                    </div>
                  ) : null}
                </div>
              </section>
            </>
          ) : (
            <div className="rounded-3xl border border-dashed border-black/15 bg-white/60 px-4 py-12 text-center text-sm leading-6 text-slate">
              Select a run from the history list to inspect steps, inputs,
              outputs, and logs.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function MetricCard({
  label,
  note,
  value
}: {
  label: string;
  note: string;
  value: number | string;
}) {
  return (
    <article className="rounded-3xl border border-black/10 bg-white/70 px-4 py-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate/65">
        {label}
      </div>
      <div className="mt-3 font-display text-3xl text-ink">{value}</div>
      <div className="mt-2 text-sm leading-6 text-slate">{note}</div>
    </article>
  );
}

function PayloadBox({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-3xl border border-black/10 bg-ink p-4 text-white">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/65">
        {label}
      </div>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-mist">
        {value ?? "Hidden or unavailable"}
      </pre>
    </div>
  );
}
