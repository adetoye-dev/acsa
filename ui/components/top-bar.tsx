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

export type WorkspaceView = "canvas" | "preview" | "history" | "logs";

type TopBarProps = {
  activeWorkflowFile: string;
  activeWorkflowName: string;
  hasUnsavedChanges: boolean;
  isRunning: boolean;
  isSaving: boolean;
  runDisabled: boolean;
  runDisabledReason?: string | null;
  onRefresh: () => void;
  onRun: () => void;
  onSave: () => void;
  saveDisabled: boolean;
  saveDisabledReason?: string | null;
  runStatus: string | null;
};

export function TopBar({
  activeWorkflowFile,
  activeWorkflowName,
  hasUnsavedChanges,
  isRunning,
  isSaving,
  runDisabled,
  runDisabledReason,
  onRefresh,
  onRun,
  onSave,
  saveDisabled,
  saveDisabledReason,
  runStatus
}: TopBarProps) {
  return (
    <section className="panel-surface overflow-hidden">
      <div className="flex h-[58px] items-center justify-between gap-4 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-xl border border-black/10 bg-ink px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
            Acsa
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate/55">
              Workflow studio
            </div>
            <div className="mt-0.5 truncate text-[15px] font-semibold text-ink">
              {activeWorkflowName}
            </div>
          </div>
        </div>

        <div className="hidden min-w-0 flex-1 items-center justify-center gap-2 lg:flex">
          <ShellBadge label={activeWorkflowFile} tone="neutral" />
          {hasUnsavedChanges ? <ShellBadge label="unsaved" tone="warn" /> : null}
          {runStatus ? <ShellBadge label={runStatus} tone="warn" /> : null}
        </div>

        <div className="flex items-center gap-2">
          <button className="ui-button" onClick={onRefresh} type="button">
            Refresh
          </button>
          <button
            className="ui-button"
            disabled={saveDisabled}
            onClick={onSave}
            title={saveDisabledReason ?? undefined}
            type="button"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
          <button
            className="ui-button ui-button-primary"
            disabled={runDisabled}
            onClick={onRun}
            title={runDisabledReason ?? undefined}
            type="button"
          >
            {isRunning ? "Running..." : "Run"}
          </button>
        </div>
      </div>
    </section>
  );
}

function ShellBadge({
  label,
  tone
}: {
  label: string;
  tone: "info" | "neutral" | "warn";
}) {
  const toneMap = {
    info: "border-tide/15 bg-tide/10 text-tide",
    neutral: "border-black/10 bg-black/[0.04] text-slate/72",
    warn: "border-ember/15 bg-ember/10 text-ember"
  } as const;

  return (
    <span
      className={`rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${toneMap[tone]}`}
    >
      {label}
    </span>
  );
}
