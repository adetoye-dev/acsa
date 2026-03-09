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
  CanvasNode,
  StepTypeEntry,
  TriggerTypeEntry,
  WorkflowDocument
} from "../lib/workflow-editor";

type NodeInspectorProps = {
  activeWorkflow: WorkflowDocument | null;
  inspectorError: string | null;
  onDeleteSelectedNode: () => void;
  onSelectedNodeIdChange: (value: string) => void;
  onSelectedNodeParamsChange: (value: string) => void;
  onSelectedNodeRetryAttemptsChange: (value: string) => void;
  onSelectedNodeRetryBackoffChange: (value: string) => void;
  onSelectedNodeTimeoutChange: (value: string) => void;
  onSelectedNodeTypeChange: (value: string) => void;
  onTriggerDetailsChange: (value: string) => void;
  onTriggerTypeChange: (value: string) => void;
  onWorkflowNameChange: (value: string) => void;
  selectedNode: CanvasNode | null;
  stepCatalog: StepTypeEntry[];
  stepParamsDraft: string;
  triggerCatalog: TriggerTypeEntry[];
  triggerDetailsDraft: string;
  workflowYaml: string;
};

export function NodeInspector({
  activeWorkflow,
  inspectorError,
  onDeleteSelectedNode,
  onSelectedNodeIdChange,
  onSelectedNodeParamsChange,
  onSelectedNodeRetryAttemptsChange,
  onSelectedNodeRetryBackoffChange,
  onSelectedNodeTimeoutChange,
  onSelectedNodeTypeChange,
  onTriggerDetailsChange,
  onTriggerTypeChange,
  onWorkflowNameChange,
  selectedNode,
  stepCatalog,
  stepParamsDraft,
  triggerCatalog,
  triggerDetailsDraft,
  workflowYaml
}: NodeInspectorProps) {
  const selectedStep =
    selectedNode?.data.kind === "step"
      ? activeWorkflow?.workflow.steps.find((step) => step.id === selectedNode.id) ?? null
      : null;
  const triggerSelected = selectedNode?.data.kind === "trigger" || !selectedNode;

  return (
    <aside className="panel-surface flex flex-col overflow-hidden">
      <div className="border-b border-black/10 px-5 py-4">
        <p className="section-kicker">Inspector</p>
        <h2 className="section-title mt-2">Workflow and node details</h2>
        <p className="mt-2 text-sm leading-6 text-slate">
          YAML stays canonical. The inspector edits the in-memory workflow
          object and the preview updates immediately.
        </p>
      </div>

      <div className="space-y-5 overflow-y-auto px-5 py-5">
        <section className="rounded-3xl border border-black/10 bg-white/70 p-4">
          <label
            className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate/65"
            htmlFor="workflow-name"
          >
            Workflow name
          </label>
          <input
            className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-tide/40"
            id="workflow-name"
            onChange={(event) => onWorkflowNameChange(event.target.value)}
            type="text"
            value={activeWorkflow?.workflow.name ?? ""}
          />
          {activeWorkflow ? (
            <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate/65">
              {activeWorkflow.summary.file_name}
            </p>
          ) : null}
        </section>

        {triggerSelected && activeWorkflow ? (
          <section className="rounded-3xl border border-black/10 bg-white/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate/65">
                  Trigger
                </div>
                <div className="mt-2 font-display text-xl text-ink">
                  {activeWorkflow.workflow.trigger.type}
                </div>
              </div>
              <span className="rounded-full bg-sand px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ember">
                Workflow entrypoint
              </span>
            </div>

            <label
              className="mb-2 mt-5 block text-xs font-semibold uppercase tracking-[0.18em] text-slate/65"
              htmlFor="trigger-type"
            >
              Trigger type
            </label>
            <select
              className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-tide/40"
              id="trigger-type"
              onChange={(event) => onTriggerTypeChange(event.target.value)}
              value={activeWorkflow.workflow.trigger.type}
            >
              {triggerCatalog.map((entry) => (
                <option key={entry.type_name} value={entry.type_name}>
                  {entry.label}
                </option>
              ))}
            </select>

            <label
              className="mb-2 mt-5 block text-xs font-semibold uppercase tracking-[0.18em] text-slate/65"
              htmlFor="trigger-details"
            >
              Trigger details (YAML object)
            </label>
            <textarea
              className="min-h-[180px] w-full rounded-3xl border border-black/10 bg-ink px-4 py-4 text-sm leading-6 text-mist outline-none transition focus:border-tide/40"
              id="trigger-details"
              onChange={(event) => onTriggerDetailsChange(event.target.value)}
              spellCheck={false}
              value={triggerDetailsDraft}
            />
          </section>
        ) : null}

        {selectedStep ? (
          <section className="rounded-3xl border border-black/10 bg-white/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate/65">
                  Selected step
                </div>
                <div className="mt-2 font-display text-xl text-ink">
                  {selectedStep.id}
                </div>
              </div>
              <button
                className="rounded-full border border-ember/20 px-3 py-2 text-xs font-semibold text-ember transition hover:border-ember/40 hover:bg-ember/5"
                onClick={onDeleteSelectedNode}
                type="button"
              >
                Delete step
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <label
                  className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate/65"
                  htmlFor="step-id"
                >
                  Step id
                </label>
                <input
                  className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-tide/40"
                  id="step-id"
                  onChange={(event) => onSelectedNodeIdChange(event.target.value)}
                  type="text"
                  value={selectedStep.id}
                />
              </div>
              <div>
                <label
                  className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate/65"
                  htmlFor="step-type"
                >
                  Step type
                </label>
                <select
                  className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-tide/40"
                  id="step-type"
                  onChange={(event) => onSelectedNodeTypeChange(event.target.value)}
                  value={selectedStep.type}
                >
                  {groupedStepOptions(stepCatalog).map(([category, entries]) => (
                    <optgroup key={category} label={titleCase(category)}>
                      {entries.map((entry) => (
                        <option key={entry.type_name} value={entry.type_name}>
                          {entry.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div>
                <label
                  className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate/65"
                  htmlFor="timeout-ms"
                >
                  Timeout (ms)
                </label>
                <input
                  className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-tide/40"
                  id="timeout-ms"
                  onChange={(event) => onSelectedNodeTimeoutChange(event.target.value)}
                  type="number"
                  value={selectedStep.timeout_ms ?? ""}
                />
              </div>
              <div>
                <label
                  className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate/65"
                  htmlFor="retry-attempts"
                >
                  Retry attempts
                </label>
                <input
                  className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-tide/40"
                  id="retry-attempts"
                  onChange={(event) => onSelectedNodeRetryAttemptsChange(event.target.value)}
                  type="number"
                  value={selectedStep.retry?.attempts ?? ""}
                />
              </div>
              <div>
                <label
                  className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate/65"
                  htmlFor="retry-backoff"
                >
                  Retry backoff (ms)
                </label>
                <input
                  className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-tide/40"
                  id="retry-backoff"
                  onChange={(event) => onSelectedNodeRetryBackoffChange(event.target.value)}
                  type="number"
                  value={selectedStep.retry?.backoff_ms ?? ""}
                />
              </div>
            </div>

            <label
              className="mb-2 mt-5 block text-xs font-semibold uppercase tracking-[0.18em] text-slate/65"
              htmlFor="step-params"
            >
              Parameters (YAML object)
            </label>
            <textarea
              className="min-h-[220px] w-full rounded-3xl border border-black/10 bg-ink px-4 py-4 text-sm leading-6 text-mist outline-none transition focus:border-tide/40"
              id="step-params"
              onChange={(event) => onSelectedNodeParamsChange(event.target.value)}
              spellCheck={false}
              value={stepParamsDraft}
            />
          </section>
        ) : null}

        {inspectorError ? (
          <div className="rounded-3xl border border-ember/20 bg-ember/5 px-4 py-3 text-sm leading-6 text-ember">
            {inspectorError}
          </div>
        ) : null}

        <div className="rounded-3xl border border-black/10 bg-white/70 p-4 text-sm leading-6 text-slate">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate/65">
            Secret policy
          </div>
          <p className="mt-3">
            Reference secrets through environment-backed fields such as
            <code className="mx-1 rounded bg-sand px-1.5 py-0.5 text-ember">
              secret_env
            </code>
            ,
            <code className="mx-1 rounded bg-sand px-1.5 py-0.5 text-ember">
              token_env
            </code>
            , or
            <code className="mx-1 rounded bg-sand px-1.5 py-0.5 text-ember">
              secrets_env
            </code>
            . Inline secret-looking values are rejected by the engine API.
          </p>
        </div>

        <div className="rounded-3xl border border-black/10 bg-ink p-4 text-white">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/65">
            YAML preview
          </div>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-mist">
            {workflowYaml}
          </pre>
        </div>
      </div>
    </aside>
  );
}

function groupedStepOptions(stepCatalog: StepTypeEntry[]) {
  const groups = new Map<string, StepTypeEntry[]>();
  for (const entry of stepCatalog) {
    const bucket = groups.get(entry.category) ?? [];
    bucket.push(entry);
    groups.set(entry.category, bucket);
  }
  return Array.from(groups.entries());
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
