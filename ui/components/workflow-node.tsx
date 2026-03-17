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
          className="!h-3 !w-3 !border-2 !border-white !bg-[#8ba0bf]"
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
              <div className="truncate text-[15px] font-semibold tracking-tight text-ink">
                {data.label}
              </div>
              <div className="mt-1 truncate text-xs leading-5 text-slate">
                {data.description}
              </div>
            </div>
            {data.executionLabel ? (
              <span className={badgeClassName(state)}>{data.executionLabel}</span>
            ) : null}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <span
              className={`inline-flex items-center rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${nodeAccentClassName({
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
                <span className="rounded-md border border-[#9a72ff]/20 bg-[#f2efff] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#7b58d8]">
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
    </div>
  );
});

function badgeClassName(state: NodeExecutionState) {
  const base =
    "rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]";
  switch (state) {
    case "running":
      return `${base} animate-pulse border border-tide/25 bg-tide/10 text-[#117d88]`;
    case "success":
      return `${base} border border-emerald-400/20 bg-emerald-400/10 text-[#198754]`;
    case "failed":
      return `${base} border border-ember/25 bg-ember/10 text-[#cd694d]`;
    case "paused":
      return `${base} border border-amber-400/20 bg-amber-400/10 text-[#b87a20]`;
    case "skipped":
      return `${base} border border-black/10 bg-black/[0.03] text-slate/70`;
    default:
      return `${base} border border-black/10 bg-white/72 text-slate/72`;
  }
}

function sourceHandleClassName(kind: CanvasNodeData["kind"]) {
  return kind === "trigger" ? "!bg-[#f0a15e]" : "!bg-[#9a72ff]";
}

function containerClassName(
  kind: CanvasNodeData["kind"],
  selected: boolean,
  state: NodeExecutionState
) {
  const base =
    "min-w-[240px] cursor-grab rounded-2xl border bg-white/92 px-4 py-3 shadow-[0_10px_28px_rgba(18,31,52,0.08)] transition duration-150 active:cursor-grabbing";
  const selectedState = selected ? "border-tide/70 ring-2 ring-tide/15" : "";
  const kindStateDefault =
  kind === "trigger"
      ? "border-[#f4a261]/28 bg-[linear-gradient(180deg,rgba(255,246,238,0.98),rgba(255,255,255,0.96))]"
      : "border-black/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(249,251,255,0.96))]";

  switch (state) {
    case "running":
      return `${base} ${selected ? selectedState : "border-tide/45"} bg-[linear-gradient(180deg,rgba(232,251,252,0.98),rgba(255,255,255,0.96))]`;
    case "success":
      return `${base} ${selected ? selectedState : "border-emerald-400/30"} bg-[linear-gradient(180deg,rgba(238,251,243,0.98),rgba(255,255,255,0.96))]`;
    case "failed":
      return `${base} ${selected ? selectedState : "border-ember/35"} bg-[linear-gradient(180deg,rgba(255,241,237,0.98),rgba(255,255,255,0.96))]`;
    case "paused":
      return `${base} ${selected ? selectedState : "border-amber-400/35"} bg-[linear-gradient(180deg,rgba(255,249,236,0.98),rgba(255,255,255,0.96))]`;
    case "skipped":
      return `${base} ${selected ? selectedState : "border-black/10"} bg-white/78`;
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
