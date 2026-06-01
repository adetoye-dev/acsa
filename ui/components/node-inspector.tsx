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
import { YamlEditor } from "./yaml-editor";
import { NodeGlyph } from "./node-visuals";

type NodeInspectorProps = {
  activeWorkflow: WorkflowDocument | null;
  inspectorError: string | null;
  onSelectedNodeParamsChange: (value: string) => void;
  onSelectedNodeRetryAttemptsChange: (value: string) => void;
  onSelectedNodeRetryBackoffChange: (value: string) => void;
  onSelectedNodeTimeoutChange: (value: string) => void;
  onSelectedNodeTypeChange: (value: string) => void;
  onTriggerDetailsChange: (value: string) => void;
  onTriggerTypeChange: (value: string) => void;
  selectedNode: CanvasNode | null;
  selectedStepType: StepTypeEntry | null;
  stepParamsDraft: string;
  triggerCatalog: TriggerTypeEntry[];
  triggerDetailsDraft: string;
};

export function NodeInspector({
  activeWorkflow,
  inspectorError,
  onSelectedNodeParamsChange,
  onSelectedNodeRetryAttemptsChange,
  onSelectedNodeRetryBackoffChange,
  onSelectedNodeTimeoutChange,
  onSelectedNodeTypeChange,
  onTriggerDetailsChange,
  onTriggerTypeChange,
  selectedNode,
  selectedStepType,
  stepParamsDraft,
  triggerCatalog,
  triggerDetailsDraft
}: NodeInspectorProps) {
  const selectedStep =
    selectedNode?.data.kind === "step"
      ? activeWorkflow?.workflow.steps.find((step) => step.id === selectedNode.id) ?? null
      : null;
  const selectedStepIsDetached =
    selectedStep !== null &&
    (activeWorkflow?.workflow.ui?.detached_steps ?? []).includes(selectedStep.id);
  const triggerSelected = selectedNode?.data.kind === "trigger";

  if (!activeWorkflow || !selectedNode) {
    return (
      <div className="px-4 py-4 text-sm leading-6 text-slate">
        Select a node on the canvas to configure it here.
      </div>
    );
  }

  return (
    <div className="min-h-full">
      {triggerSelected ? (
        <section className="border-b border-black/10 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/62">
                Trigger
              </div>
              <div className="mt-1 text-[13px] text-slate">
                Configure how this workflow starts.
              </div>
            </div>
            <span className="rounded-[8px] border border-black/10 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#636b75]">
              Entrypoint
            </span>
          </div>

          <label
            className="mb-2 mt-4 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/62"
            htmlFor="trigger-type"
          >
            Trigger type
          </label>
          <select
            className="ui-input"
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
            className="mb-2 mt-4 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/62"
            htmlFor="trigger-details"
          >
            Trigger details
          </label>
          <YamlEditor
            id="trigger-details"
            minHeight={168}
            onChange={onTriggerDetailsChange}
            value={triggerDetailsDraft}
          />
        </section>
      ) : null}

      {selectedStep ? (
        <section className="px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/62">
                Step configuration
              </div>
              <div className="mt-1 text-[13px] text-slate">
                Tune runtime behavior and parameters for this step.
              </div>
            </div>
            {selectedStepIsDetached ? (
              <span className="rounded-[8px] border border-black/10 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#666c75]">
                Detached
              </span>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3">
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/62">
                Capability
              </div>
              <div className="flex items-center gap-3 rounded-[12px] border border-black/10 bg-[#fbfbfa] px-3.5 py-2.5">
                <NodeGlyph
                  category={selectedNode.data.category}
                  className="shrink-0"
                  kind={selectedNode.data.kind}
                  size="sm"
                  typeName={selectedNode.data.typeName}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-ink">
                    {selectedStepType?.label ?? (selectedStep ? titleCase(selectedStep.type) : "Unknown")}
                  </div>
                  {selectedStepType?.description ? (
                    <div className="mt-1 text-[12px] leading-relaxed text-slate">
                      {selectedStepType.description}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div>
              <label
                className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/62"
                htmlFor="timeout-ms"
              >
                Timeout
              </label>
              <input
                className="ui-input font-mono"
                id="timeout-ms"
                onChange={(event) => onSelectedNodeTimeoutChange(event.target.value)}
                type="number"
                value={selectedStep.timeout_ms ?? ""}
              />
            </div>
            <div>
              <label
                className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/62"
                htmlFor="retry-attempts"
              >
                Retries
              </label>
              <input
                className="ui-input font-mono"
                id="retry-attempts"
                onChange={(event) => onSelectedNodeRetryAttemptsChange(event.target.value)}
                type="number"
                value={selectedStep.retry?.attempts ?? ""}
              />
            </div>
            <div>
              <label
                className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/62"
                htmlFor="retry-backoff"
              >
                Backoff
              </label>
              <input
                className="ui-input font-mono"
                id="retry-backoff"
                onChange={(event) => onSelectedNodeRetryBackoffChange(event.target.value)}
                type="number"
                value={selectedStep.retry?.backoff_ms ?? ""}
              />
            </div>
          </div>

          <label
            className="mb-2 mt-4 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/62"
            htmlFor="step-params"
          >
            Parameters
          </label>
          <YamlEditor
            id="step-params"
            minHeight={300}
            onChange={onSelectedNodeParamsChange}
            value={stepParamsDraft}
          />
        </section>
      ) : null}

      {inspectorError ? (
        <div className="border-t border-ember/20 bg-[#fff0eb] px-4 py-3 text-sm leading-6 text-[#cd694d]">
          {inspectorError}
        </div>
      ) : null}
    </div>
  );
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
