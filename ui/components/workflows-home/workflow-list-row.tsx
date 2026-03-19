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
  workflowReadinessLabel
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
  const metadata = isRecent
    ? buildRecentMetadata(workflow, recentOpenedAt ?? null)
    : buildCompactMetadata(workflow);

  return (
    <Link
      className={`group block rounded-[16px] border border-black/10 bg-white/94 shadow-[0_1px_0_rgba(16,20,20,0.02)] transition hover:-translate-y-0.5 hover:border-black/15 hover:bg-white ${
        isRecent ? "px-4 py-4" : "px-3.5 py-3.5"
      }`}
      href={href}
    >
      <div className="min-w-0">
        <div
          className={`truncate font-medium tracking-tight text-ink ${
            isRecent ? "text-[15px]" : "text-[14px]"
          }`}
        >
          {workflow.name}
        </div>
        <div
          className={`mt-1 text-slate/72 ${
            isRecent
              ? "text-[12.5px] leading-6"
              : "text-[12px] leading-[1.45rem]"
          }`}
        >
          {metadata.join(" · ")}
        </div>
      </div>
    </Link>
  );
}

function buildRecentMetadata(
  workflow: WorkflowSummary,
  recentOpenedAt: number | null
) {
  const parts = [
    recentOpenedAt ? `Opened ${formatRelativeOpenedAt(recentOpenedAt)}` : null,
    workflowLifecycleLabel(workflow.workflow_state),
    workflowReadinessLabel(workflow.workflow_state)
  ];
  const lastRun = workflowLastRunLabel(workflow.workflow_state);
  if (lastRun !== "Never run") {
    parts.push(lastRun);
  }
  return parts.filter((part): part is string => Boolean(part));
}

function buildCompactMetadata(workflow: WorkflowSummary) {
  const parts = [
    workflow.file_name,
    workflowLifecycleLabel(workflow.workflow_state),
    workflowReadinessLabel(workflow.workflow_state),
    `${workflow.step_count} step${workflow.step_count === 1 ? "" : "s"}`,
    `${workflow.trigger_type} trigger`
  ];
  const lastRun = workflowLastRunLabel(workflow.workflow_state);
  if (lastRun !== "Never run") {
    parts.push(lastRun);
  }
  return parts;
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
