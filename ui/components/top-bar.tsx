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

export type WorkspaceView = "canvas" | "preview";

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
    <section className="overflow-hidden border-b border-black/10 bg-[rgba(255,255,255,0.84)]">
      <div className="flex h-[60px] items-center justify-between gap-4 px-4">
        {showBrand ? (
          <div className="flex min-w-0 items-center gap-3">
            <img
              alt="Acsa"
              className="h-10 w-10 shrink-0"
              src="/acsa-mark.svg"
            />
            <div className="min-w-0">
              <div className="text-sm font-medium tracking-tight text-ink">
                Acsa
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate/55">
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
            <div className="inline-flex min-w-0 max-w-[300px] items-center gap-2 rounded-[9px] bg-black/[0.04] px-3 py-1.5">
              <FileIcon />
              <div className="min-w-0 truncate text-sm font-medium text-ink">
                {activeWorkflowFile}
              </div>
            </div>
          <div className="flex min-w-0 items-center flex-1 justify-center">
            <div
              aria-label="Workspace view"
              className="flex items-center gap-0.5 rounded-[9px] bg-black/[0.06] p-0.5"
              role="tablist"
            >
            {(["canvas", "preview"] as WorkspaceView[]).map((view) => (
              <button
                aria-selected={activeView === view}
                key={view}
                className={workspaceTabClassName(activeView === view)}
                onClick={() => onChangeView(view)}
                role="tab"
                type="button"
              >
                {view.charAt(0).toUpperCase() + view.slice(1)}
              </button>
            ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <TopBarActionButton
            icon={<RefreshIcon />}
            label="Refresh"
            onClick={onRefresh}
            variant="soft"
          />
          {hasUnsavedChanges || isSaving ? (
            <TopBarActionButton
              disabled={saveDisabled || isSaving}
              icon={<SaveIcon />}
              label={isSaving ? "Saving..." : "Save"}
              onClick={onSave}
              title={saveDisabledReason ?? undefined}
              variant="ghost"
            />
          ) : (
            <div className="px-1 text-[13px] font-medium tracking-[-0.01em] text-black/42">
              Saved
            </div>
          )}
          <TopBarActionButton
            disabled={runDisabled || isRunning}
            icon={<RunIcon />}
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
  return `inline-flex h-7 items-center rounded-[7px] px-2.5 text-[12.5px] font-medium tracking-[-0.01em] transition-colors duration-150 ${
    active
      ? "bg-white text-[#12161b] shadow-[0_1px_2px_rgba(16,20,20,0.06)]"
      : "text-black/58 hover:bg-white/55 hover:text-[#1c1f24]"
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
      ? "bg-[#ddd4ff] text-[#4b3786] hover:bg-[#d2c7ff]"
      : variant === "soft"
        ? "bg-black/[0.04] text-[#1c1f24] hover:bg-black/[0.055]"
        : "bg-transparent text-[#2a2e34] hover:bg-black/[0.032]";

  return (
    <button
      className={`inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium tracking-[-0.01em] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      <span className="shrink-0 opacity-80">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function RefreshIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12.75 5.5A5.25 5.25 0 1 0 13 8m-.25-4v2.5H10.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3 3.25h7.4l2.35 2.35v7.15H3V3.25Zm2.25 0V6h4V3.25m-4 7.5h5.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
    </svg>
  );
}

function RunIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.35" />
      <path
        d="M6.75 5.9 10.4 8l-3.65 2.1V5.9Z"
        fill="currentColor"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="0.35"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5 shrink-0 text-black/42"
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4 2.75h5l3 3v7.5H4v-10.5Zm5 0v3h3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
    </svg>
  );
}
