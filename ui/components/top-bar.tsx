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

type TopBarProps = {
  activeWorkflowFile: string;
  activeWorkflowName: string;
  isRunning: boolean;
  isSaving: boolean;
  lastAction: string;
  onRefresh: () => void;
  onRun: () => void;
  onSave: () => void;
  pendingTaskCount: number;
  runStatus: string | null;
};

export function TopBar({
  activeWorkflowFile,
  activeWorkflowName,
  isRunning,
  isSaving,
  lastAction,
  onRefresh,
  onRun,
  onSave,
  pendingTaskCount,
  runStatus
}: TopBarProps) {
  return (
    <section className="panel-surface overflow-hidden">
      <div className="flex flex-col gap-5 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-3xl">
          <p className="section-kicker">Achsah Systems</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink">
            Acsa workflow studio
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate">
            A local-first editor for YAML workflows, bounded DAG execution, and
            secure connector expansion.
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-3 lg:min-w-[420px] lg:items-end">
          <div className="rounded-2xl border border-black/10 bg-white/70 px-4 py-3 text-sm text-slate">
            <div>
              <span className="font-semibold text-ink">Active workflow:</span>{" "}
              {activeWorkflowName}
            </div>
            <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate/65">
              {activeWorkflowFile}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]">
              <span className="rounded-full bg-sand px-3 py-1 text-ember">
                {pendingTaskCount} pending task{pendingTaskCount === 1 ? "" : "s"}
              </span>
              {runStatus ? (
                <span className="rounded-full bg-tide/10 px-3 py-1 text-tide">
                  {runStatus}
                </span>
              ) : null}
            </div>
            <div className="mt-3 text-xs uppercase tracking-[0.18em] text-slate/65">
              {lastAction}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:border-ink/20 hover:bg-white/90"
              onClick={onRefresh}
              type="button"
            >
              Refresh
            </button>
            <button
              className="rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:border-ink/20 hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving}
              onClick={onSave}
              type="button"
            >
              {isSaving ? "Saving..." : "Save YAML"}
            </button>
            <button
              className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isRunning}
              onClick={onRun}
              type="button"
            >
              {isRunning ? "Running..." : "Run workflow"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
