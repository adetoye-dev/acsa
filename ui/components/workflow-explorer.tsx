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

import type {
  InvalidWorkflowFile,
  StepTypeEntry,
  WorkflowSummary
} from "../lib/workflow-editor";

type WorkflowExplorerProps = {
  activeWorkflowId: string | null;
  connectors: StepTypeEntry[];
  invalidFiles: InvalidWorkflowFile[];
  isBusy: boolean;
  onCreateWorkflow: () => void;
  onDeleteWorkflow: (workflowId: string) => void;
  onDuplicateWorkflow: (workflowId: string) => void;
  onSelectWorkflow: (workflowId: string) => void;
  workflows: WorkflowSummary[];
};

export function WorkflowExplorer({
  activeWorkflowId,
  connectors,
  invalidFiles,
  isBusy,
  onCreateWorkflow,
  onDeleteWorkflow,
  onDuplicateWorkflow,
  onSelectWorkflow,
  workflows
}: WorkflowExplorerProps) {
  return (
    <aside className="panel-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="section-kicker">Workflow explorer</p>
          <h2 className="section-title mt-2">YAML definitions</h2>
        </div>
        <button
          className="ui-button ui-button-tide"
          disabled={isBusy}
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
            <article
              key={workflow.id}
              className={`rounded-2xl border px-4 py-4 transition ${
                isActive
                  ? "border-tide/40 bg-tide/10"
                  : "border-black/10 bg-white/70 hover:border-black/20 hover:bg-white"
              }`}
            >
              <button
                className="w-full text-left"
                onClick={() => onSelectWorkflow(workflow.id)}
                type="button"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-display text-lg font-semibold text-ink">
                    {workflow.name}
                  </span>
                  <span className="ui-badge">
                    {workflow.trigger_type}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate">
                  {workflow.description}
                </p>
                <div className="mt-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-slate/65">
                  <span>{workflow.file_name}</span>
                  {workflow.has_connector_steps ? (
                    <span className="rounded-md bg-ember/10 px-2 py-1 text-ember">
                      Connector step
                    </span>
                  ) : null}
                </div>
              </button>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="ui-button"
                  disabled={isBusy}
                  onClick={() => onDuplicateWorkflow(workflow.id)}
                  type="button"
                >
                  Duplicate
                </button>
                <button
                  className="ui-button ui-button-danger"
                  disabled={isBusy}
                  onClick={() => onDeleteWorkflow(workflow.id)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {invalidFiles.length > 0 ? (
        <div className="mt-6 rounded-2xl border border-ember/20 bg-ember/5 p-4">
          <p className="section-kicker text-ember">Needs attention</p>
          <div className="mt-3 space-y-3">
            {invalidFiles.map((file) => (
              <div key={file.id} className="rounded-xl border border-ember/15 bg-white/80 p-3">
                <div className="text-sm font-semibold text-ink">{file.file_name}</div>
                <p className="mt-1 text-sm leading-6 text-slate">{file.error}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-6 rounded-2xl border border-black/10 bg-white/65 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="section-kicker">Connectors</p>
            <h3 className="section-title mt-2">Loaded plugins</h3>
          </div>
          <span className="ui-badge">{connectors.length}</span>
        </div>

        <p className="mt-3 text-sm leading-6 text-slate">
          Connector nodes are discovered from the local
          <code className="mx-1 rounded bg-sand px-1.5 py-0.5 font-mono text-ember">
            connectors/
          </code>
          directory. Shipping a drag-and-drop installer still needs a backend upload API.
        </p>

        <div className="mt-4 space-y-3">
          {connectors.length > 0 ? (
            connectors.map((connector) => (
              <article
                key={connector.type_name}
                className="rounded-xl border border-black/10 bg-white/80 px-3 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-ink">{connector.label}</div>
                  <span className="rounded-md bg-tide/10 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-tide">
                    {connector.runtime ?? "plugin"}
                  </span>
                </div>
                <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-slate/65">
                  {connector.type_name}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate">
                  {connector.description}
                </p>
              </article>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-black/15 bg-white/80 px-4 py-6 text-center text-sm leading-6 text-slate">
              No connector manifests are loaded yet. Built-in nodes remain available in the canvas.
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
