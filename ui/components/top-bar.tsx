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
import { RefreshCw, Save, Play, FileText } from "lucide-react";

export type WorkspaceView = "canvas" | "yaml";

type TopBarProps = {
  activeWorkflowFile: string;
  activeView: WorkspaceView;
  hasUnsavedChanges: boolean;
  isRunning: boolean;
  isSaving: boolean;
  onChangeView: (view: WorkspaceView) => void;
  runDisabled: boolean;
  runDisabledReason?: string | null;
  onRefresh: () => void;
  onRun: () => void;
  onSave: () => void;
  saveDisabled: boolean;
  saveDisabledReason?: string | null;
  showBrand?: boolean;
};

export function TopBar({
  activeWorkflowFile,
  activeView,
  hasUnsavedChanges,
  isRunning,
  isSaving,
  onChangeView,
  runDisabled,
  runDisabledReason,
  onRefresh,
  onRun,
  onSave,
  saveDisabled,
  saveDisabledReason,
  showBrand = true
}: TopBarProps) {
  return (
    <section className="overflow-hidden border-b border-black/5 bg-white/80 backdrop-blur-xl z-50">
      <div className="flex h-[60px] items-center justify-between gap-4 px-4">
        {showBrand ? (
          <div className="flex min-w-0 items-center gap-3">
            <img
              alt="Acsa"
              className="h-9 w-9 shrink-0 drop-shadow-sm transition-transform hover:scale-105"
              src="/acsa-mark.svg"
            />
            <div className="min-w-0">
              <div className="text-[14px] font-bold tracking-tight text-ink">
                Acsa
              </div>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6f63ff]/80">
                Workflow studio
              </div>
            </div>
          </div>
        ) : null}

        <div
          className={`hidden min-w-0 flex-1 gap-4 items-center lg:flex ${
            showBrand ? "justify-center" : "justify-start"
          }`}
        >
            <div className="inline-flex min-w-0 max-w-[300px] items-center gap-2 rounded-[10px] bg-black/[0.03] px-3 py-1.5 shadow-[inset_0_1px_1px_rgba(0,0,0,0.01)] border border-black/5 cursor-default hover:bg-black/[0.04] transition-colors">
              <FileText size={15} strokeWidth={2} className="text-[#6f63ff]/70" />
              <div className="min-w-0 truncate text-[13px] font-semibold text-ink">
                {activeWorkflowFile}
              </div>
            </div>
          <div className="flex min-w-0 items-center flex-1 justify-center">
            <div
              aria-label="Workspace view"
              className="flex items-center gap-1 rounded-[10px] bg-black/[0.04] p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)]"
              role="tablist"
            >
            {(["canvas", "yaml"] as WorkspaceView[]).map((view) => (
              <button
                aria-selected={activeView === view}
                key={view}
                className={workspaceTabClassName(activeView === view)}
                onClick={() => onChangeView(view)}
                role="tab"
                type="button"
              >
                {view === "yaml" ? "YAML" : "Canvas"}
              </button>
            ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <TopBarActionButton
            icon={<RefreshCw size={14} strokeWidth={2.5} />}
            label="Refresh"
            onClick={onRefresh}
            variant="soft"
          />
          {hasUnsavedChanges || isSaving ? (
            <TopBarActionButton
              disabled={saveDisabled || isSaving}
              icon={<Save size={14} strokeWidth={2.5} />}
              label={isSaving ? "Saving..." : "Save"}
              onClick={onSave}
              title={saveDisabledReason ?? undefined}
              variant="ghost"
            />
          ) : (
            <div className="px-2 text-[12px] font-bold uppercase tracking-widest text-emerald-500/80">
              Saved
            </div>
          )}
          <TopBarActionButton
            disabled={runDisabled || isRunning}
            icon={<Play size={14} strokeWidth={2.5} fill="currentColor" />}
            label={isRunning ? "Running..." : "Run"}
            onClick={onRun}
            title={runDisabledReason ?? undefined}
            variant="accent"
          />
        </div>
      </div>
    </section>
  );
}

function workspaceTabClassName(active: boolean) {
  return `inline-flex h-7 items-center rounded-[7px] px-3.5 text-[12px] font-bold tracking-wide transition-all duration-200 ${
    active
      ? "bg-white text-ink shadow-sm"
      : "text-slate hover:bg-white/50 hover:text-ink"
  }`;
}

function TopBarActionButton({
  disabled = false,
  icon,
  label,
  onClick,
  title,
  variant
}: {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  title?: string;
  variant: "accent" | "ghost" | "soft";
}) {
  const className =
    variant === "accent"
      ? "bg-gradient-to-br from-[#776cff] to-[#5d52d8] text-white shadow-[0_2px_4px_rgba(111,99,255,0.2)] hover:shadow-[0_4px_8px_rgba(111,99,255,0.3)] hover:-translate-y-0.5 border border-[#5d52d8]/20"
      : variant === "soft"
        ? "bg-black/[0.04] text-[#1c1f24] hover:bg-black/[0.06] border border-transparent shadow-[inset_0_1px_1px_rgba(0,0,0,0.01)]"
        : "bg-transparent text-[#2a2e34] hover:bg-black/[0.04] border border-transparent";

  return (
    <button
      className={`inline-flex h-8 items-center gap-1.5 rounded-[9px] px-3.5 text-[12.5px] font-semibold tracking-wide transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:transform-none disabled:hover:shadow-none ${className}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      <span className={`shrink-0 ${variant === "accent" ? "opacity-100" : "opacity-80"}`}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}
