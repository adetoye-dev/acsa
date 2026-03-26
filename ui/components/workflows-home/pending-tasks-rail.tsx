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

import type { HumanTask } from "../../lib/workflow-editor";

type PendingTasksRailProps = {
  isRefreshing: boolean;
  onApprove: (taskId: string, approved: boolean) => void;
  onRefresh: () => void;
  onResolveValue: (taskId: string) => void;
  onValueChange: (taskId: string, value: string) => void;
  taskValues: Record<string, string>;
  tasks: HumanTask[];
};

export function PendingTasksRail({
  isRefreshing,
  onApprove,
  onRefresh,
  onResolveValue,
  onValueChange,
  taskValues,
  tasks
}: PendingTasksRailProps) {
  return (
    <aside className="grid min-h-0 grid-rows-[60px_minmax(0,1fr)] border-l border-black/10 bg-[rgba(255,255,255,0.84)]">
      <div className="flex items-center justify-between gap-3 border-b border-black/10 px-5">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/58">
            Pending tasks
          </div>
          <div className="mt-0.5 text-[14px] font-medium tracking-tight text-ink">
            Approvals and inputs
          </div>
        </div>
        <button className="ui-button !px-2.5 !py-1.5" onClick={onRefresh} type="button">
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="sleek-scroll min-h-0 overflow-y-auto px-4 py-4">
        {tasks.length === 0 ? (
          <div className="rounded-[16px] border border-black/10 bg-white px-4 py-5 text-sm leading-6 text-slate">
            Nothing is waiting right now. Paused runs that need approval or input will show up here.
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <article
                className="rounded-[16px] border border-black/10 bg-white px-4 py-4"
                key={task.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/58">
                      {task.kind === "approval" ? "Approval" : "Manual input"}
                    </div>
                    <div className="mt-1 text-sm font-medium leading-6 text-ink">{task.prompt}</div>
                  </div>
                  <span className="rounded-[8px] border border-black/10 bg-[#fafafb] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-slate/62">
                    {task.step_id}
                  </span>
                </div>

                <div className="mt-3 text-[12px] leading-5 text-slate/72">
                  Run {task.run_id.slice(0, 8)}
                </div>

                {task.kind === "approval" ? (
                  <div className="mt-4 flex gap-2">
                    <button
                      className="ui-button ui-button-primary !px-3 !py-2"
                      onClick={() => onApprove(task.id, true)}
                      type="button"
                    >
                      Approve
                    </button>
                    <button
                      className="ui-button ui-button-danger !px-3 !py-2"
                      onClick={() => onApprove(task.id, false)}
                      type="button"
                    >
                      Reject
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 space-y-2.5">
                    <input
                      aria-label={task.field ?? "value"}
                      className="ui-input"
                      onChange={(event) => onValueChange(task.id, event.target.value)}
                      placeholder={task.field ?? "Enter a value"}
                      type="text"
                      value={taskValues[task.id] ?? ""}
                    />
                    <button
                      className="ui-button ui-button-primary !px-3 !py-2"
                      onClick={() => onResolveValue(task.id)}
                      type="button"
                    >
                      Send value
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
