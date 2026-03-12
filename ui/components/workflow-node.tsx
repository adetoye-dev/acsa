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
      ? formatToken(data.typeName)
      : data.runtime
        ? `${formatToken(data.source ?? "connector")} · ${data.runtime}`
        : formatToken(data.source ?? "built_in");

  return (
    <div className={containerClassName(data.kind, selected, state)}>
      <div className="mb-3 flex cursor-grab items-center justify-between rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2 active:cursor-grabbing">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate/60">
          {data.kind === "trigger" ? "Trigger" : "Step"}
        </span>
        <span className="font-mono text-[11px] text-slate/55">::</span>
      </div>

      {data.kind === "step" ? (
        <Handle
          className="!h-3 !w-3 !border-2 !border-white !bg-ink/85"
          position={Position.Left}
          type="target"
        />
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate/70">
              {data.kind === "trigger" ? "Entrypoint" : formatToken(data.typeName)}
            </div>
            {data.detached ? (
              <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-slate/60">
                Draft
              </span>
            ) : null}
          </div>
          <div className="mt-2 truncate text-base font-semibold tracking-tight text-ink">
            {data.label}
          </div>
        </div>
        {data.executionLabel ? (
          <span className={badgeClassName(state)}>{data.executionLabel}</span>
        ) : null}
      </div>

      <div className="mt-3 text-xs leading-5 text-slate">{data.description}</div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate/65">
          {footerLabel}
        </span>
        {data.executionMeta ? (
          <span className="font-mono text-[11px] text-slate/70">{data.executionMeta}</span>
        ) : null}
      </div>

      <Handle
        className="!h-3 !w-3 !border-2 !border-white !bg-tide"
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
      return `${base} animate-pulse bg-tide/10 text-tide`;
    case "success":
      return `${base} bg-emerald-500/10 text-emerald-700`;
    case "failed":
      return `${base} bg-ember/10 text-ember`;
    case "paused":
      return `${base} bg-amber-500/10 text-amber-700`;
    case "skipped":
      return `${base} bg-black/5 text-slate`;
    default:
      return `${base} bg-sand text-ember`;
  }
}

function containerClassName(
  kind: CanvasNodeData["kind"],
  selected: boolean,
  state: NodeExecutionState
) {
  const base =
    "min-w-[240px] cursor-grab rounded-2xl border bg-white px-4 py-3 shadow-none transition duration-150 active:cursor-grabbing";
  const selectedState = selected ? "border-tide/60 ring-2 ring-tide/15" : "";
  const kindStateDefault =
    kind === "trigger"
      ? "border-ink/20 bg-[#f8f5ef]"
      : "border-black/10";

  switch (state) {
    case "running":
      return `${base} ${selected ? selectedState : "border-tide/45"} bg-tide/5`;
    case "success":
      return `${base} ${selected ? selectedState : "border-emerald-500/35"} bg-emerald-500/5`;
    case "failed":
      return `${base} ${selected ? selectedState : "border-ember/45"} bg-ember/5`;
    case "paused":
      return `${base} ${selected ? selectedState : "border-amber-500/45"} bg-amber-500/5`;
    case "skipped":
      return `${base} ${selected ? selectedState : "border-black/10"} bg-black/[0.03]`;
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
