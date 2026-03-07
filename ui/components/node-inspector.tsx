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

import type { Node } from "@xyflow/react";

type CanvasNodeData = {
  label: string;
  note: string;
  params: Record<string, string>;
  typeName: string;
};

type NodeInspectorProps = {
  onLabelChange: (label: string) => void;
  selectedNode: Node<CanvasNodeData> | null;
  workflowDescription: string;
  workflowYaml: string;
};

export function NodeInspector({
  onLabelChange,
  selectedNode,
  workflowDescription,
  workflowYaml
}: NodeInspectorProps) {
  return (
    <aside className="panel-surface flex flex-col overflow-hidden">
      <div className="border-b border-black/10 px-5 py-4">
        <p className="section-kicker">Inspector</p>
        <h2 className="section-title mt-2">Node details</h2>
        <p className="mt-2 text-sm leading-6 text-slate">{workflowDescription}</p>
      </div>

      <div className="space-y-5 px-5 py-5">
        {selectedNode ? (
          <>
            <div>
              <label
                className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate/65"
                htmlFor="node-label"
              >
                Label
              </label>
              <input
                className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-tide/40"
                id="node-label"
                onChange={(event) => onLabelChange(event.target.value)}
                type="text"
                value={selectedNode.data.label}
              />
            </div>

            <div className="rounded-3xl border border-black/10 bg-white/70 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate/65">
                Type
              </div>
              <div className="mt-2 font-display text-xl text-ink">
                {selectedNode.data.typeName}
              </div>
              <p className="mt-3 text-sm leading-6 text-slate">
                {selectedNode.data.note}
              </p>
            </div>

            <div className="rounded-3xl border border-black/10 bg-white/70 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate/65">
                Parameters
              </div>
              <dl className="mt-3 space-y-3">
                {Object.entries(selectedNode.data.params).map(([key, value]) => (
                  <div key={key} className="flex items-start justify-between gap-3">
                    <dt className="text-sm font-semibold text-ink">{key}</dt>
                    <dd className="max-w-[180px] text-right text-sm text-slate">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </>
        ) : (
          <div className="rounded-3xl border border-dashed border-black/15 bg-white/50 px-4 py-10 text-center text-sm leading-6 text-slate">
            Select a node on the canvas to inspect and edit its label.
          </div>
        )}

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
