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

import Link from "next/link";

import {
  workflowLastRunLabel,
  workflowLifecycleLabel,
  workflowLifecycleTone,
  workflowReadinessLabel,
  workflowReadinessTone
} from "../../lib/product-status";
import type { WorkflowSummary } from "../../lib/workflow-editor";

type WorkflowListRowProps = {
  density?: "compact" | "recent";
  href: string;
  recentOpenedAt?: number | null;
  workflow: WorkflowSummary;
};

export function WorkflowListRow({
  density = "compact",
  href,
  recentOpenedAt,
  workflow
}: WorkflowListRowProps) {
  const isRecent = density === "recent";

  return (
    <Link
      className={`group block rounded-[16px] border border-black/10 bg-white/94 shadow-[0_1px_0_rgba(16,20,20,0.02)] transition hover:-translate-y-0.5 hover:border-black/15 hover:bg-white ${
        isRecent ? "px-4 py-4" : "px-3.5 py-3.5"
      }`}
      href={href}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <div
              className={`truncate font-medium tracking-tight text-ink ${
                isRecent ? "text-[15px]" : "text-[14px]"
              }`}
            >
              {workflow.name}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-slate/55">
              <span className="truncate">{workflow.file_name}</span>
              {recentOpenedAt ? (
                <>
                  <span className="text-slate/35">•</span>
                  <span>Opened {formatRelativeOpenedAt(recentOpenedAt)}</span>
                </>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <span
              className={`rounded-[8px] px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] ${workflowLifecycleTone(workflow.workflow_state)}`}
            >
              {workflowLifecycleLabel(workflow.workflow_state)}
            </span>
            <span
              className={`rounded-[8px] px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] ${workflowReadinessTone(workflow.workflow_state)}`}
            >
              {workflowReadinessLabel(workflow.workflow_state)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[12px] leading-5 text-slate">
          <span>{workflow.step_count} steps</span>
          <span className="text-slate/35">•</span>
          <span>{workflow.trigger_type} trigger</span>
          {workflow.has_connector_steps ? (
            <>
              <span className="text-slate/35">•</span>
              <span>connector-backed</span>
            </>
          ) : null}
        </div>

        <div className="text-[11.5px] leading-5 text-slate/70">
          {workflowLastRunLabel(workflow.workflow_state)}
        </div>
      </div>
    </Link>
  );
}

function formatRelativeOpenedAt(openedAt: number): string {
  const elapsed = Math.max(0, Date.now() - openedAt);
  if (elapsed < 60_000) {
    return "just now";
  }
  if (elapsed < 3_600_000) {
    return `${Math.max(1, Math.round(elapsed / 60_000))}m ago`;
  }
  if (elapsed < 86_400_000) {
    return `${Math.max(1, Math.round(elapsed / 3_600_000))}h ago`;
  }
  return `${Math.max(1, Math.round(elapsed / 86_400_000))}d ago`;
}
