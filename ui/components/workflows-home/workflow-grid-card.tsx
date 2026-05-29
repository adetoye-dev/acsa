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
  Zap, 
  ArrowRight, 
  MoreVertical, 
  Edit2, 
  Copy, 
  Download, 
  Play, 
  Trash2 
} from "lucide-react";

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
  onRename?: (id: string, name: string) => void;
  onDuplicate?: (id: string) => void;
  onExport?: (id: string, name: string) => void;
  onRun?: (id: string, name: string) => void;
  onDelete?: (id: string, name: string) => void;
};

export function WorkflowGridCard({
  href,
  recentOpenedAt,
  workflow,
  onRename,
  onDuplicate,
  onExport,
  onRun,
  onDelete
}: WorkflowGridCardProps) {
  const [lastOpened, setLastOpened] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

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
      className="group relative flex min-h-[168px] flex-col rounded-[16px] border border-black/5 bg-white/95 p-4 shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-[#6f63ff]/20 hover:bg-white hover:shadow-[0_12px_32px_rgba(111,99,255,0.08)]"
      href={href}
    >
      {/* Background click capture overlay to dismiss dropdown */}
      {menuOpen && (
        <div 
          className="fixed inset-0 z-40 bg-transparent" 
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuOpen(false);
          }}
        />
      )}

      {/* Floating Card Actions Button & Dropdown Menu */}
      <div className="absolute top-4 right-4 z-50">
        <button
          type="button"
          aria-label="Workflow actions"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
          className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-black/5 bg-white text-slate/75 hover:bg-black/[0.04] hover:text-ink transition-colors shadow-sm"
        >
          <MoreVertical size={15} strokeWidth={2.5} />
        </button>

        {menuOpen && (
          <div className="absolute right-0 mt-1.5 w-[160px] rounded-[12px] border border-black/6 bg-white p-1.5 shadow-lg z-50">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen(false);
                onRename?.(workflow.id, workflow.name);
              }}
              className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12.5px] font-semibold text-slate hover:bg-black/[0.04] hover:text-ink transition-colors"
            >
              <Edit2 size={13} />
              <span>Rename</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen(false);
                onDuplicate?.(workflow.id);
              }}
              className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12.5px] font-semibold text-slate hover:bg-black/[0.04] hover:text-ink transition-colors"
            >
              <Copy size={13} />
              <span>Duplicate</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen(false);
                onExport?.(workflow.id, workflow.name);
              }}
              className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12.5px] font-semibold text-slate hover:bg-black/[0.04] hover:text-ink transition-colors"
            >
              <Download size={13} />
              <span>Export YAML</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen(false);
                onRun?.(workflow.id, workflow.name);
              }}
              className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12.5px] font-semibold text-slate hover:bg-black/[0.04] hover:text-ink transition-colors"
            >
              <Play size={13} />
              <span>Run Workflow</span>
            </button>
            <div className="my-1 border-b border-black/[0.04]" />
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen(false);
                onDelete?.(workflow.id, workflow.name);
              }}
              className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12.5px] font-semibold text-rose-500 hover:bg-rose-50 hover:text-rose-600 transition-colors"
            >
              <Trash2 size={13} />
              <span>Delete</span>
            </button>
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#f3f0ff] to-[#e6dfff] text-[#6f63ff] shadow-[inset_0_1px_2px_rgba(255,255,255,0.8)] transition-transform duration-300 group-hover:scale-110">
          <Zap size={16} strokeWidth={2.5} className="fill-current" />
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] shadow-sm mr-9 ${readinessTone}`}
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
