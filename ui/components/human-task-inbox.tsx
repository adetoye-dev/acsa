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
  embedded?: boolean;
  isRefreshing: boolean;
  onApprove: (taskId: string, approved: boolean) => void;
  onRefresh: () => void;
  onResolveValue: (taskId: string) => void;
  onValueChange: (taskId: string, value: string) => void;
  taskValues: Record<string, string>;
  tasks: HumanTask[];
};

export function HumanTaskInbox({
  embedded = false,
  isRefreshing,
  onApprove,
  onRefresh,
  onResolveValue,
  onValueChange,
  taskValues,
  tasks
}: HumanTaskInboxProps) {
  const content = (
    <div className="space-y-3">
      {!embedded ? (
        <div className="flex items-center justify-end">
          <button className="ui-button" onClick={onRefresh} type="button">
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/15 bg-white/60 px-4 py-6 text-center text-sm leading-6 text-slate">
          No pending human tasks. Runs that pause for approval or input will
          appear here and can be resumed without leaving the editor.
        </div>
      ) : null}

      {tasks.map((task) => (
        <article
          key={task.id}
          className="rounded-2xl border border-black/10 bg-white/70 p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate/65">
                {task.kind}
              </div>
              <h3 className="mt-2 text-base font-semibold text-ink">{task.prompt}</h3>
            </div>
            <span className="ui-badge font-mono">
              {task.step_id}
            </span>
          </div>

          <p className="mt-3 font-mono text-sm leading-6 text-slate">Run: {task.run_id}</p>

          {task.kind === "approval" ? (
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                className="ui-button ui-button-primary"
                onClick={() => onApprove(task.id, true)}
                type="button"
              >
                Approve
              </button>
              <button
                className="ui-button ui-button-danger"
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
                className="ui-input font-mono"
                onChange={(event) => onValueChange(task.id, event.target.value)}
                placeholder={task.field ?? "value"}
                type="text"
                value={taskValues[task.id] ?? ""}
              />
              <button
                className="ui-button ui-button-primary"
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
  );

  if (embedded) {
    return content;
  }

  return (
    <section className="panel-surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-4">
        <div>
          <p className="section-kicker">Required actions</p>
          <h2 className="section-title mt-1">Pending approvals and inputs</h2>
        </div>
      </div>

      <div className="px-4 py-4">{content}</div>
    </section>
  );
}
