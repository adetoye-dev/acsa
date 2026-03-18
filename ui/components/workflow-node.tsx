"use client";

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

import { memo } from "react";

import {
  Handle,
  Position,
  type NodeProps
} from "@xyflow/react";

import {
  NodeGlyph,
  nodeAccentClassName
} from "./node-visuals";
import type {
  CanvasNode,
  CanvasNodeData,
  NodeExecutionState
} from "../lib/workflow-editor";

export const WorkflowNode = memo(function WorkflowNode({
  data,
  selected
}: NodeProps<CanvasNode>) {
  const state = data.executionState ?? "idle";
  const footerLabel =
    data.kind === "trigger"
      ? "entrypoint"
      : data.runtime
        ? `${formatToken(data.source ?? "connector")} · ${data.runtime}`
        : formatToken(data.source ?? "built_in");

  return (
    <div className={containerClassName(data.kind, selected, state)}>
      {data.kind === "step" ? (
        <Handle
          className="!h-3 !w-3 !border-2 !border-white !bg-[#96a0ab]"
          position={Position.Left}
          type="target"
        />
      ) : null}

      <div className="flex items-start gap-3">
        <NodeGlyph
          category={data.category}
          className="shrink-0"
          kind={data.kind}
          source={data.source}
          typeName={data.typeName}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[14px] font-medium tracking-tight text-ink">
                {data.label}
              </div>
              <div className="mt-0.5 truncate text-[12px] leading-5 text-slate">
                {data.description}
              </div>
            </div>
            {data.executionLabel ? (
              <span className={badgeClassName(state)}>{data.executionLabel}</span>
            ) : null}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <span
              className={`inline-flex items-center rounded-[8px] border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${nodeAccentClassName({
                category: data.category,
                kind: data.kind,
                source: data.source,
                typeName: data.typeName
              })}`}
            >
              {data.kind === "trigger" ? formatToken(data.typeName) : footerLabel}
            </span>
            <div className="flex items-center gap-2">
              {data.detached ? (
                <span className="rounded-[8px] border border-black/10 bg-[#f6f7f9] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#666c75]">
                  Draft
                </span>
              ) : null}
              {data.executionMeta ? (
                <span className="font-mono text-[11px] text-slate/65">{data.executionMeta}</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <Handle
        className={`!h-3 !w-3 !border-2 !border-white ${sourceHandleClassName(data.kind)}`}
        position={Position.Right}
        type="source"
      />

      {selected && data.onAddAfter ? (
        <button
          aria-label={`Add step after ${data.label}`}
          className="absolute right-[-14px] top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[10px] border border-black/10 bg-white text-lg font-medium text-[#3b4653] shadow-[0_1px_4px_rgba(16,20,20,0.08)] transition hover:border-[#6f63ff]/24 hover:bg-[#f7f7fb]"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            data.onAddAfter?.(data.nodeId);
          }}
          type="button"
        >
          +
        </button>
      ) : null}
    </div>
  );
});

function badgeClassName(state: NodeExecutionState) {
  const base =
    "rounded-[8px] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]";
  switch (state) {
    case "running":
      return `${base} animate-pulse border border-[#6f63ff]/26 bg-[#f6f4ff] text-[#5d52d8]`;
    case "success":
      return `${base} border border-emerald-400/20 bg-[#eff9f2] text-[#2e7b54]`;
    case "failed":
      return `${base} border border-ember/22 bg-[#fdf1ec] text-[#c25f47]`;
    case "paused":
      return `${base} border border-amber-400/20 bg-[#fdf8eb] text-[#a47123]`;
    case "skipped":
      return `${base} border border-black/10 bg-[#f6f7f9] text-slate/70`;
    default:
      return `${base} border border-black/10 bg-white text-slate/72`;
  }
}

function sourceHandleClassName(kind: CanvasNodeData["kind"]) {
  return kind === "trigger" ? "!bg-[#6f63ff]" : "!bg-[#8376ff]";
}

function containerClassName(
  kind: CanvasNodeData["kind"],
  selected: boolean,
  state: NodeExecutionState
) {
  const base =
    "relative min-w-[232px] cursor-grab rounded-[12px] border bg-white px-4 py-3 shadow-[0_1px_2px_rgba(16,20,20,0.04)] transition duration-150 active:cursor-grabbing";
  const selectedState = selected ? "border-[#6f63ff] ring-1 ring-[#6f63ff]/18" : "";
  const kindStateDefault =
  kind === "trigger"
      ? "border-black/10 bg-white"
      : "border-black/10 bg-white";

  switch (state) {
    case "running":
      return `${base} ${selected ? selectedState : "border-[#6f63ff]/26"} bg-[#faf9ff]`;
    case "success":
      return `${base} ${selected ? selectedState : "border-emerald-400/24"} bg-white`;
    case "failed":
      return `${base} ${selected ? selectedState : "border-ember/24"} bg-white`;
    case "paused":
      return `${base} ${selected ? selectedState : "border-amber-400/24"} bg-white`;
    case "skipped":
      return `${base} ${selected ? selectedState : "border-black/10"} bg-[#f8f8fa]`;
    default:
      return `${base} ${selectedState} ${kindStateDefault}`;
  }
}

function formatToken(value?: string | null) {
  if (!value) {
    return "built in";
  }
  return value.replace(/[_-]+/g, " ");
}
