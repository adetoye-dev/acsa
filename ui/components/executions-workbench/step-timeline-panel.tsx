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

import { formatDuration, type RunDetailResponse } from "../../lib/observability";
import { latestStepRunsByStep } from "../../lib/executions-workbench";

type StepTimelinePanelProps = {
  isLoading: boolean;
  nodeLabels: Record<string, string>;
  onSelectStepId: (stepId: string | null) => void;
  runDetail: RunDetailResponse | null;
  selectedStepId: string | null;
};

export function StepTimelinePanel({
  isLoading,
  nodeLabels,
  onSelectStepId,
  runDetail,
  selectedStepId
}: StepTimelinePanelProps) {
  const latestStepRuns = useMemo(
    () => latestStepRunsByStep(runDetail?.step_runs ?? []),
    [runDetail]
  );

  if (!runDetail) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <EmptyState>
          {isLoading
            ? "Loading run detail…"
            : "Select a run to inspect timeline details."}
        </EmptyState>
      </div>
    );
  }

  return (
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
          const stepLabel = nodeLabels[stepRun.step_id] ?? stepRun.step_id;
          return (
            <button
              key={stepRun.id}
              className={`w-full rounded-[12px] border px-3 py-2 text-left transition ${
                active
                  ? "border-[#cfc6ff] bg-[#f7f5ff]"
                  : stepRun.status === "failed"
                    ? "border-black/10 bg-white hover:border-rose-400/25"
                    : stepRun.status === "paused"
                      ? "border-black/10 bg-white hover:border-amber-400/25"
                      : stepRun.status === "running"
                        ? "border-black/10 bg-white hover:border-[#6f63ff]/28"
                        : "border-black/10 bg-white hover:border-black/18"
              }`}
              onClick={() => onSelectStepId(stepRun.step_id)}
              type="button"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink">{stepLabel}</div>
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

        {!latestStepRuns.length ? (
          <EmptyState>
            This run has no recorded step attempts yet.
          </EmptyState>
        ) : null}
      </div>
    </section>
  );
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
