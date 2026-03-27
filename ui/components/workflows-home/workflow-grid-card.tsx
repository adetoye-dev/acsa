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

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import {
  workflowLastRunLabel,
  workflowLifecycleLabel,
  workflowReadinessLabel,
  workflowReadinessTone
} from "../../lib/product-status";
import type { WorkflowSummary } from "../../lib/workflow-editor";

type WorkflowGridCardProps = {
  href: string;
  recentOpenedAt?: number | null;
  workflow: WorkflowSummary;
};

export function WorkflowGridCard({
  href,
  recentOpenedAt,
  workflow
}: WorkflowGridCardProps) {
  const [lastOpened, setLastOpened] = useState<string | null>(null);

  useEffect(() => {
    if (recentOpenedAt) {
      setLastOpened(formatRelativeOpenedAt(recentOpenedAt));
      return;
    }
    setLastOpened(null);
  }, [recentOpenedAt]);

  const lastRun = workflowLastRunLabel(workflow.workflow_state);
  const readinessTone = workflowReadinessTone(workflow.workflow_state);

  return (
    <Link
      className="group flex min-h-[178px] flex-col rounded-[18px] border border-black/10 bg-white px-5 py-4 transition hover:-translate-y-0.5 hover:border-black/16 hover:shadow-[0_10px_28px_rgba(16,20,20,0.06)]"
      href={href}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-[#d8d2ff] bg-[#f5f2ff] text-[#6f63ff]">
          <WorkflowBoltIcon />
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${readinessTone}`}
        >
          {workflowReadinessLabel(workflow.workflow_state)}
        </span>
      </div>

      <div className="mt-5 min-w-0">
        <div className="truncate text-[16px] font-medium tracking-tight text-ink">
          {workflow.name}
        </div>
        <div className="mt-2 line-clamp-2 min-h-[2.75rem] text-sm leading-6 text-slate">
          {workflow.description || "No description yet."}
        </div>
      </div>

      <div className="mt-auto space-y-2 pt-5">
        <div className="flex flex-wrap gap-2 text-[12px] leading-5 text-slate/80">
          <span>{workflowLifecycleLabel(workflow.workflow_state)}</span>
          <span>&middot;</span>
          <span>
            {workflow.step_count} node{workflow.step_count === 1 ? "" : "s"}
          </span>
          {lastOpened ? (
            <>
              <span>&middot;</span>
              <span>Opened {lastOpened}</span>
            </>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-black/8 pt-3 text-[12px] leading-5 text-slate/72">
          <span>{lastRun === "Never run" ? "Ready to run" : lastRun}</span>
          <ArrowRightIcon />
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
    return `${Math.max(1, Math.floor(elapsed / 60_000))}m ago`;
  }
  if (elapsed < 86_400_000) {
    return `${Math.max(1, Math.floor(elapsed / 3_600_000))}h ago`;
  }
  return `${Math.max(1, Math.floor(elapsed / 86_400_000))}d ago`;
}

function WorkflowBoltIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 16 16">
      <path
        d="M8.7 1.8 4.6 8h2.75L6.55 14.2 11.4 7.45H8.6l.1-5.65Z"
        fill="currentColor"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="0.35"
      />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5 text-black/28 transition group-hover:text-black/52" fill="none" viewBox="0 0 16 16">
      <path
        d="M4 8h8m0 0-3-3m3 3-3 3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}
