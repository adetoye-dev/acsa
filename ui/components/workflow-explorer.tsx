// Copyright 2026 Achsah Systems
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

type WorkflowSummary = {
  description: string;
  id: string;
  name: string;
};

type WorkflowExplorerProps = {
  activeWorkflowId: string;
  onCreateWorkflow: () => void;
  onSelectWorkflow: (workflowId: string) => void;
  workflows: WorkflowSummary[];
};

export function WorkflowExplorer({
  activeWorkflowId,
  onCreateWorkflow,
  onSelectWorkflow,
  workflows
}: WorkflowExplorerProps) {
  return (
    <aside className="panel-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="section-kicker">Workflow explorer</p>
          <h2 className="section-title mt-2">Local definitions</h2>
        </div>
        <button
          className="rounded-full bg-tide px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-[#0d5b61]"
          onClick={onCreateWorkflow}
          type="button"
        >
          New
        </button>
      </div>

      <div className="mt-5 space-y-3">
        {workflows.map((workflow) => {
          const isActive = workflow.id === activeWorkflowId;

          return (
            <button
              key={workflow.id}
              className={`w-full rounded-3xl border px-4 py-4 text-left transition ${
                isActive
                  ? "border-tide/40 bg-tide/10 shadow-panel"
                  : "border-black/10 bg-white/70 hover:border-black/20 hover:bg-white"
              }`}
              onClick={() => onSelectWorkflow(workflow.id)}
              type="button"
            >
              <div className="flex items-center justify-between">
                <span className="font-display text-lg font-semibold text-ink">
                  {workflow.name}
                </span>
                <span className="rounded-full bg-sand px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ember">
                  YAML
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate">
                {workflow.description}
              </p>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
