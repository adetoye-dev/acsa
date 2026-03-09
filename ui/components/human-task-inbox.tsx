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

import type { HumanTask } from "../lib/workflow-editor";

type HumanTaskInboxProps = {
  isRefreshing: boolean;
  onApprove: (taskId: string, approved: boolean) => void;
  onRefresh: () => void;
  onResolveValue: (taskId: string) => void;
  onValueChange: (taskId: string, value: string) => void;
  taskValues: Record<string, string>;
  tasks: HumanTask[];
};

export function HumanTaskInbox({
  isRefreshing,
  onApprove,
  onRefresh,
  onResolveValue,
  onValueChange,
  taskValues,
  tasks
}: HumanTaskInboxProps) {
  return (
    <section className="panel-surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-black/10 px-5 py-4">
        <div>
          <p className="section-kicker">Human tasks</p>
          <h2 className="section-title mt-2">Approval and input inbox</h2>
        </div>
        <button
          className="rounded-full border border-ink/10 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink transition hover:border-ink/20 hover:bg-white/90"
          onClick={onRefresh}
          type="button"
        >
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="space-y-4 px-5 py-5">
        {tasks.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-black/15 bg-white/60 px-4 py-8 text-center text-sm leading-6 text-slate">
            No pending human tasks. Runs that pause for approval or input will
            appear here and can be resumed without leaving the editor.
          </div>
        ) : null}

        {tasks.map((task) => (
          <article
            key={task.id}
            className="rounded-3xl border border-black/10 bg-white/70 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate/65">
                  {task.kind}
                </div>
                <h3 className="mt-2 font-display text-xl text-ink">{task.prompt}</h3>
              </div>
              <span className="rounded-full bg-sand px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ember">
                {task.step_id}
              </span>
            </div>

            <p className="mt-3 text-sm leading-6 text-slate">Run: {task.run_id}</p>

            {task.kind === "approval" ? (
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate"
                  onClick={() => onApprove(task.id, true)}
                  type="button"
                >
                  Approve
                </button>
                <button
                  className="rounded-full border border-ember/20 px-4 py-2 text-sm font-semibold text-ember transition hover:border-ember/40 hover:bg-ember/5"
                  onClick={() => onApprove(task.id, false)}
                  type="button"
                >
                  Reject
                </button>
              </div>
            ) : null}

            {task.kind === "manual_input" ? (
              <div className="mt-4 space-y-3">
                <input
                  aria-label={task.field ?? "value"}
                  className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-tide/40"
                  onChange={(event) => onValueChange(task.id, event.target.value)}
                  placeholder={task.field ?? "value"}
                  type="text"
                  value={taskValues[task.id] ?? ""}
                />
                <button
                  className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate"
                  onClick={() => onResolveValue(task.id)}
                  type="button"
                >
                  Submit value
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
