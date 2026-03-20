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

import type { WorkflowDocument } from "../lib/workflow-editor";
import { formatDuration, formatTimestamp } from "../lib/observability";

type WorkflowContextRailProps = {
  activeRunStatus: string | null;
  hasRunnableSteps: boolean;
  latestRun?: {
    duration_seconds?: number | null;
    started_at: number;
    status: string;
  } | null;
  mode: "canvas" | "preview";
  pendingTaskCount: number;
  workflow: WorkflowDocument | null;
};

export function WorkflowContextRail({
  activeRunStatus,
  hasRunnableSteps,
  latestRun,
  mode,
  pendingTaskCount,
  workflow
}: WorkflowContextRailProps) {
  if (!workflow) {
    return (
      <div className="px-4 py-4 text-sm leading-6 text-slate">
        No workflow is loaded yet.
      </div>
    );
  }

  const stepCount = workflow.workflow.steps.length;
  const status = activeRunStatus?.split(" • ")[0] ?? "idle";
  const triggerSummary = summarizeTrigger(workflow.workflow.trigger);

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)]">
      <section className="border-b border-black/10 px-4 py-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/62">
          Workflow
        </div>
        <div className="mt-1 text-[15px] font-medium tracking-tight text-ink">
          {workflow.workflow.name}
        </div>
        <div className="mt-3 space-y-2 text-sm text-slate">
          <DetailRow label="File" value={workflow.summary.file_name} />
          <DetailRow label="Trigger" value={workflow.workflow.trigger.type} />
          <DetailRow
            label="Steps"
            value={`${stepCount} step${stepCount === 1 ? "" : "s"}`}
          />
          <DetailRow label="Status" value={status} />
        </div>
      </section>

      <section className="border-b border-black/10 px-4 py-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/62">
          Trigger
        </div>
        <div className="mt-1 text-[15px] font-medium tracking-tight text-ink">
          {workflow.workflow.trigger.type}
        </div>
        <div className="mt-2 text-[13px] leading-6 text-slate">{triggerSummary}</div>
      </section>

      <section className="px-4 py-4">
        <div className="space-y-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/62">
              Readiness
            </div>
            <div className="mt-2 space-y-2 text-sm text-slate">
              <DetailRow label="Runnable" value={hasRunnableSteps ? "Yes" : "Add a step"} />
              <DetailRow
                label="Pending"
                value={`${pendingTaskCount} task${pendingTaskCount === 1 ? "" : "s"}`}
              />
              <DetailRow label="Mode" value={mode === "preview" ? "Review" : "Build"} />
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/62">
              Recent activity
            </div>
            <div className="mt-2 space-y-2 text-sm text-slate">
              {latestRun ? (
                <>
                  <DetailRow label="Last run" value={latestRun.status} />
                  <DetailRow label="Started" value={formatTimestamp(latestRun.started_at)} />
                  <DetailRow
                    label="Duration"
                    value={formatDuration(latestRun.duration_seconds)}
                  />
                </>
              ) : (
                <div className="text-[13px] leading-6 text-slate">
                  No executions yet for this workflow.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function summarizeTrigger(trigger: WorkflowDocument["workflow"]["trigger"]) {
  const schedule =
    pickFirstString(trigger, ["schedule", "cron", "expression", "spec"]) ?? null;
  const path = pickFirstString(trigger, ["path", "route"]) ?? null;
  const method = pickFirstString(trigger, ["method", "http_method"]) ?? null;

  if (trigger.type === "manual") {
    return "Runs on demand from the editor, API, or CLI.";
  }

  if (trigger.type === "cron") {
    return schedule ? `Scheduled with ${schedule}.` : "Scheduled trigger configured in YAML.";
  }

  if (trigger.type === "webhook") {
    const parts = [method?.toUpperCase(), path].filter(Boolean);
    return parts.length > 0
      ? `Accepts ${parts.join(" ")} requests.`
      : "Accepts authenticated incoming HTTP requests.";
  }

  return "Configured through workflow YAML.";
}

function pickFirstString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function DetailRow({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-black/10 pb-2 last:border-b-0 last:pb-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate/55">
        {label}
      </span>
      <span className="truncate text-right text-[13px] text-ink">{value}</span>
    </div>
  );
}
