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
import { Zap, ArrowRight } from "lucide-react";

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
      className="group flex min-h-[156px] flex-col rounded-[16px] border border-black/5 bg-white/95 p-4 shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-[#6f63ff]/20 hover:bg-white hover:shadow-[0_12px_32px_rgba(111,99,255,0.08)]"
      href={href}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#f3f0ff] to-[#e6dfff] text-[#6f63ff] shadow-[inset_0_1px_2px_rgba(255,255,255,0.8)] transition-transform duration-300 group-hover:scale-110">
          <Zap size={16} strokeWidth={2.5} className="fill-current" />
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] shadow-sm ${readinessTone}`}
        >
          {workflowReadinessLabel(workflow.workflow_state)}
        </span>
      </div>

      <div className="mt-4 min-w-0">
        <div className="truncate text-[15px] font-semibold tracking-tight text-ink">
          {workflow.name}
        </div>
        <div className="mt-1 line-clamp-2 min-h-[2.5rem] text-[13px] leading-5 text-slate/80">
          {workflow.description || "No description yet."}
        </div>
      </div>

      <div className="mt-auto space-y-1 pt-4">
        <div className="flex flex-wrap gap-1.5 text-[11px] font-medium tracking-wide text-slate/70">
          <span>{workflowLifecycleLabel(workflow.workflow_state)}</span>
          <span>&middot;</span>
          <span>
            {workflow.step_count} step{workflow.step_count === 1 ? "" : "s"}
          </span>
          {lastOpened ? (
            <>
              <span>&middot;</span>
              <span>Opened {lastOpened}</span>
            </>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-black/5 pt-2 text-[12px] font-medium text-slate/60 transition-colors group-hover:text-ink/80">
          <span>{lastRun === "Never run" ? "Ready to run" : lastRun}</span>
          <ArrowRight size={14} strokeWidth={2.5} className="transition-transform duration-300 group-hover:translate-x-1" />
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
