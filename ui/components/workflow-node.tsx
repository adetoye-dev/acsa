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
import { motion, AnimatePresence } from "framer-motion";

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

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={`group ${containerClassName(data.kind, selected, state)}`}
    >
      {data.kind === "step" ? (
        <Handle
          className="!h-3 !w-3 !border-2 !border-white !bg-[#96a0ab] hover:!scale-125 transition-transform"
          position={Position.Left}
          type="target"
        />
      ) : null}

      <div className="flex items-start gap-3">
        <NodeGlyph
          category={data.category}
          className="shrink-0"
          kind={data.kind}
          size="lg"
          source={data.source}
          typeName={data.typeName}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold tracking-tight text-ink">
                {data.label}
              </div>
              <div className="mt-0.5 truncate text-[12px] leading-5 text-slate/80">
                {data.description}
              </div>
            </div>
            <AnimatePresence>
              {data.executionLabel ? (
                <motion.span 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className={badgeClassName(state)}
                >
                  {data.executionLabel}
                </motion.span>
              ) : null}
            </AnimatePresence>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {data.detached ? (
                <span className="rounded-[8px] border border-black/5 bg-[#f6f7f9]/80 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#666c75]">
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
        className={`!h-3 !w-3 !border-2 !border-white hover:!scale-125 transition-transform ${sourceHandleClassName(data.kind)}`}
        position={Position.Right}
        type="source"
      />

      <AnimatePresence>
        {selected && data.onAddAfter ? (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            aria-label={`Add step after ${data.label}`}
            className="absolute right-[-14px] top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[10px] border border-black/10 bg-white/90 backdrop-blur-md text-lg font-medium text-[#3b4653] shadow-[0_2px_8px_rgba(100,100,200,0.15)] transition-all hover:scale-110 hover:border-[#6f63ff]/40 hover:bg-[#f7f7fb] hover:text-[#6f63ff]"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              data.onAddAfter?.(data.nodeId);
            }}
            type="button"
          >
            +
          </motion.button>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
});

function badgeClassName(state: NodeExecutionState) {
  const base =
    "rounded-[8px] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] shadow-sm transition-colors duration-300";
  switch (state) {
    case "running":
      return `${base} border border-[#6f63ff]/30 bg-[#f6f4ff] text-[#5d52d8]`;
    case "success":
      return `${base} border border-emerald-400/30 bg-[#eff9f2] text-[#2e7b54]`;
    case "failed":
      return `${base} border border-ember/30 bg-[#fdf1ec] text-[#c25f47]`;
    case "paused":
      return `${base} border border-amber-400/30 bg-[#fdf8eb] text-[#a47123]`;
    case "skipped":
      return `${base} border border-black/5 bg-[#f6f7f9] text-slate/70`;
    default:
      return `${base} border border-black/5 bg-white text-slate/72`;
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
    "relative min-w-[232px] cursor-grab rounded-[16px] border bg-white/95 p-3 shadow-md backdrop-blur-md transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-xl hover:border-[#6f63ff]/30 active:cursor-grabbing";
  const selectedState = selected ? "border-[#6f63ff] ring-2 ring-[#6f63ff]/20 shadow-lg !bg-white scale-[1.02]" : "border-black/5";

  switch (state) {
    case "running":
      return `${base} ${selected ? selectedState : "border-[#6f63ff]/26"} bg-gradient-to-br from-[#faf9ff] to-[#f2efff] animate-pulse`;
    case "success":
      return `${base} ${selected ? selectedState : "border-emerald-400/24"} bg-gradient-to-br from-white to-[#f6fbf7]`;
    case "failed":
      return `${base} ${selected ? selectedState : "border-ember/24"} bg-gradient-to-br from-white to-[#fff9f7]`;
    case "paused":
      return `${base} ${selected ? selectedState : "border-amber-400/24"} bg-gradient-to-br from-white to-[#fffcf5]`;
    case "skipped":
      return `${base} ${selected ? selectedState : "border-black/10"} bg-[#f8f8fa]/80`;
    default:
      return `${base} ${selectedState}`;
  }
}
