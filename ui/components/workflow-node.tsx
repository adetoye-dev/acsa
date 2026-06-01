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

"use client";

import { memo } from "react";
import { motion, AnimatePresence } from "framer-motion";

import {
  Handle,
  Position,
  type NodeProps
} from "@xyflow/react";

import { Zap, Sparkles, User, Workflow, Blocks, Box } from "lucide-react";
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
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-center select-none group w-[56px] h-[56px] relative animate-none"
    >
      {data.kind === "step" ? (
        <Handle
          className="!h-2.5 !w-2.5 !border-2 !border-white !bg-[#96a0ab] hover:!scale-125 transition-transform"
          position={Position.Left}
          type="target"
        />
      ) : null}

      {/* Outer White Rounded Container */}
      <div className={containerClassName(selected, state)}>
        
        {/* Status Indicators (✓, ●, ✕) in corners */}
        {state === "success" && (
          <div className="absolute -bottom-1 -right-1 h-4.5 w-4.5 rounded-full border border-white bg-emerald-500 flex items-center justify-center text-white text-[9px] font-bold shadow-sm z-10 animate-none">
            ✓
          </div>
        )}
        {state === "running" && (
          <div className="absolute -bottom-1 -right-1 h-4.5 w-4.5 rounded-full border border-white bg-[#6f63ff] flex items-center justify-center text-white text-[9px] font-bold shadow-sm z-10">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#6f63ff] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
          </div>
        )}
        {state === "failed" && (
          <div className="absolute -bottom-1 -right-1 h-4.5 w-4.5 rounded-full border border-white bg-red-500 flex items-center justify-center text-white text-[9px] font-bold shadow-sm z-10">
            ✕
          </div>
        )}
        {state === "paused" && (
          <div className="absolute -bottom-1 -right-1 h-4.5 w-4.5 rounded-full border border-white bg-amber-500 flex items-center justify-center text-white text-[9px] font-bold shadow-sm z-10">
            ●
          </div>
        )}
        {data.detached && (
          <div className="absolute -top-1 -right-1 px-1 py-0.25 rounded-md border border-white bg-[#96a0ab] flex items-center justify-center text-white text-[7.5px] font-bold shadow-sm z-10 uppercase tracking-wide">
            Draft
          </div>
        )}

        {/* Circular Colored Icon Box wrapping tightly around the icon */}
        <span className={`inline-flex items-center justify-center border h-8 w-8 rounded-full shadow-sm shrink-0 ${iconFamilyClass(data.category, data.kind, data.source, data.typeName)}`}>
          <NodeIcon
            category={data.category}
            kind={data.kind}
            source={data.source}
            typeName={data.typeName}
            size={16}
          />
        </span>
      </div>

      {/* Node Labels Centered Underneath */}
      <div className="mt-2 text-center w-[120px] absolute top-[56px] left-1/2 -translate-x-1/2 pointer-events-none">
        <div className="truncate text-[11px] font-bold text-ink leading-tight px-1">
          {data.label}
        </div>
        <div className="mt-0.5 truncate text-[9px] text-[#757d88] leading-none px-1">
          {data.description}
        </div>
      </div>

      <Handle
        className={`!h-2.5 !w-2.5 !border-2 !border-white hover:!scale-125 transition-transform ${sourceHandleClassName(data.kind)}`}
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
            className="absolute right-[-16px] top-[12px] z-20 flex h-8 w-8 items-center justify-center rounded-[10px] border border-black/10 bg-white/90 backdrop-blur-md text-lg font-medium text-[#3b4653] shadow-[0_2px_8px_rgba(100,100,200,0.15)] transition-all hover:scale-110 hover:border-[#6f63ff]/40 hover:bg-[#f7f7fb] hover:text-[#6f63ff]"
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

function sourceHandleClassName(kind: CanvasNodeData["kind"]) {
  return kind === "trigger" ? "!bg-[#6f63ff]" : "!bg-[#8376ff]";
}

function containerClassName(
  selected: boolean,
  state: NodeExecutionState
) {
  const base =
    "relative h-[56px] w-[56px] rounded-[16px] border bg-white shadow-sm transition-all duration-300 flex items-center justify-center hover:shadow-md hover:border-[#6f63ff]/30 cursor-grab active:cursor-grabbing";
  const selectedState = selected ? "border-[#6f63ff] ring-2 ring-[#6f63ff]/20 shadow-md scale-[1.02]" : "border-black/10";

  if (state === "running") {
    return `${base} ${selectedState} animate-pulse`;
  }

  return `${base} ${selectedState}`;
}

function iconFamilyClass(
  category?: string | null,
  kind?: CanvasNodeData["kind"],
  source?: string | null,
  typeName?: string
) {
  const normalizedType = (typeName ?? "").toLowerCase();
  if (normalizedType.includes("sheets") || normalizedType.includes("google_sheets") || normalizedType.includes("google-sheets")) {
    return "bg-gradient-to-br from-[#eafaf1] to-[#cbf2db] text-[#107c41] border-[#a3e2bb]";
  }
  if (normalizedType.includes("slack")) {
    return "bg-gradient-to-br from-[#fbf5fc] to-[#f4e2f7] text-[#e01e5a] border-[#e8c0ed]";
  }
  if (normalizedType.includes("openai") || normalizedType.includes("llm_completion")) {
    return "bg-gradient-to-br from-[#f4fbf7] to-[#dcfce7] text-[#10b981] border-[#bbf7d0]";
  }
  if (normalizedType.includes("database") || normalizedType.includes("postgres") || normalizedType.includes("postgresql") || normalizedType.includes("database_query")) {
    return "bg-gradient-to-br from-[#eef2ff] to-[#e0e7ff] text-[#3b82f6] border-[#c7d2fe]";
  }

  const normalizedCategory = (category ?? "").toLowerCase();
  const normalizedSource = (source ?? "").toLowerCase();

  let family = "core";
  if (kind === "trigger" || normalizedCategory === "trigger") {
    family = "trigger";
  } else if (
    normalizedCategory.includes("ai") ||
    /(llm|embedding|retrieval|classification|extraction|agent|model)/.test(normalizedType)
  ) {
    family = "ai";
  } else if (
    normalizedCategory.includes("human") ||
    /(approval|manual_input|human)/.test(normalizedType)
  ) {
    family = "human";
  } else if (
    normalizedCategory.includes("flow") ||
    normalizedCategory.includes("logic") ||
    /(condition|switch|loop|parallel|branch|if)/.test(normalizedType)
  ) {
    family = "flow";
  } else if (
    normalizedCategory.includes("integration") ||
    normalizedCategory.includes("connector") ||
    normalizedSource === "connector" ||
    /(http|database|file|webhook)/.test(normalizedType)
  ) {
    family = "app";
  }

  switch (family) {
    case "trigger":
      return "bg-gradient-to-br from-[#eefaf3] to-[#d8f4e2] text-[#2fa36b] border-[#caecd8]";
    case "ai":
      return "bg-gradient-to-br from-[#f3f0ff] to-[#e7e1ff] text-[#6f63ff] border-[#ddd4ff]";
    case "human":
      return "bg-gradient-to-br from-[#fff3e7] to-[#ffe5cc] text-[#c98632] border-[#f3d9b5]";
    case "flow":
      return "bg-gradient-to-br from-[#eef6ff] to-[#d9eaff] text-[#4d78cc] border-[#d7e6ff]";
    case "app":
      return "bg-gradient-to-br from-[#eef9f7] to-[#d8f3ec] text-[#2f8f7b] border-[#cfe9e2]";
    default:
      return "bg-gradient-to-br from-[#f5f6f8] to-[#eaecf0] text-[#5c6470] border-[#e1e4e8]";
  }
}

function NodeIcon({
  category,
  kind,
  source,
  typeName,
  size
}: {
  category?: string | null;
  kind: CanvasNodeData["kind"];
  source?: string | null;
  typeName: string;
  size: number;
}) {
  const normalizedCategory = (category ?? "").toLowerCase();
  const normalizedType = typeName.toLowerCase();
  const normalizedSource = (source ?? "").toLowerCase();

  const isGoogleSheets = normalizedType.includes("sheets") || normalizedType.includes("google_sheets") || normalizedType.includes("google-sheets");
  const isSlack = normalizedType.includes("slack");
  const isOpenAi = normalizedType.includes("openai") || normalizedType.includes("llm_completion");
  const isDatabase = normalizedType.includes("database") || normalizedType.includes("postgres") || normalizedType.includes("postgresql") || normalizedType.includes("database_query");

  if (isGoogleSheets) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className="drop-shadow-sm">
        <rect x="3" y="3" width="18" height="18" rx="3.5" fill="#107C41" />
        <path d="M7 8.5h10M7 12h10M7 15.5h10" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
        <rect x="11.2" y="6" width="1.6" height="12" fill="#FFFFFF" opacity="0.3" />
      </svg>
    );
  }
  if (isSlack) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className="drop-shadow-sm" fill="none" fillRule="evenodd">
        {/* Top Left - Blue */}
        <path d="M5.04 15.17a2.52 2.52 0 1 1-2.52 2.52h2.52v-2.52z" fill="#36C5F0" />
        <path d="M6.3 15.17a2.52 2.52 0 0 1 2.52-2.52h5.04a2.52 2.52 0 0 1 2.52 2.52v5.04a2.52 2.52 0 0 1-2.52 2.52H8.82a2.52 2.52 0 0 1-2.52-2.52v-5.04z" fill="#36C5F0" />
        {/* Top Right - Green */}
        <path d="M8.82 5.04A2.52 2.52 0 1 1 6.3 2.52v2.52h2.52z" fill="#2EB67D" />
        <path d="M8.82 6.3a2.52 2.52 0 0 1 2.52 2.52v5.04a2.52 2.52 0 0 1-2.52 2.52H3.78a2.52 2.52 0 0 1-2.52-2.52V8.82a2.52 2.52 0 0 1 2.52-2.52h5.04z" fill="#2EB67D" />
        {/* Bottom Right - Red */}
        <path d="M18.96 8.82a2.52 2.52 0 1 1 2.52-2.52h-2.52v-2.52z" fill="#E01E5A" stroke="none" />
        <path d="M17.7 8.82a2.52 2.52 0 0 1-2.52 2.52h-5.04a2.52 2.52 0 0 1-2.52-2.52V3.78a2.52 2.52 0 0 1 2.52-2.52h5.04a2.52 2.52 0 0 1 2.52 2.52v5.04z" fill="#E01E5A" stroke="none" />
        {/* Bottom Left - Yellow */}
        <path d="M15.17 18.96a2.52 2.52 0 1 1 2.52-2.52v2.52h-2.52z" fill="#ECB22E" />
        <path d="M15.17 17.7a2.52 2.52 0 0 1-2.52-2.52v-5.04a2.52 2.52 0 0 1 2.52-2.52h5.04a2.52 2.52 0 0 1 2.52 2.52v5.04a2.52 2.52 0 0 1-2.52 2.52h-5.04z" fill="#ECB22E" />
      </svg>
    );
  }
  if (isOpenAi) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className="drop-shadow-sm">
        <path d="M21.3 10.1a5.6 5.6 0 0 0-2.4-3.3 5.7 5.7 0 0 0-5.7-.3L10.6 8 8.1 6.5a5.7 5.7 0 0 0-5.7.3 5.6 5.6 0 0 0-2.4 3.3 5.6 5.6 0 0 0 .9 4.1c.9 1.3 2.3 2.2 3.8 2.5l2.6 1.5 2.5 1.5a5.7 5.7 0 0 0 5.7-.3 5.6 5.6 0 0 0 2.4-3.3 5.6 5.6 0 0 0-.9-4.1zm-8.8 8.2c-.8.5-1.8.6-2.6.2l-4.2-2.4a3.8 3.8 0 0 1-1.6-2.2 3.8 3.8 0 0 1 .6-2.8l2.6 1.5 4.2 2.4c.8.5 1.3 1.4 1.3 2.3v1.2zm1-2.9l-4.2-2.4a3.8 3.8 0 0 1-1.6-2.2 3.8 3.8 0 0 1 .6-2.8 3.8 3.8 0 0 1 2.6-.2l4.2 2.4v5.2zm4.1-1.7l-2.6-1.5V10c0-.9-.5-1.8-1.3-2.3l-4.2-2.4c.8-.5 1.8-.6 2.6-.2l4.2 2.4a3.8 3.8 0 0 1 1.6 2.2 3.8 3.8 0 0 1-.9 2.8z" fill="#10A37F" />
      </svg>
    );
  }
  if (isDatabase) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className="drop-shadow-sm">
        <ellipse cx="12" cy="5" rx="9" ry="3" fill="#336791" opacity="0.8" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" stroke="#336791" strokeWidth="2" fill="none" />
        <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" stroke="#336791" strokeWidth="2" fill="none" />
      </svg>
    );
  }

  let family = "core";
  if (kind === "trigger" || normalizedCategory === "trigger") {
    family = "trigger";
  } else if (
    normalizedCategory.includes("ai") ||
    /(llm|embedding|retrieval|classification|extraction|agent|model)/.test(normalizedType)
  ) {
    family = "ai";
  } else if (
    normalizedCategory.includes("human") ||
    /(approval|manual_input|human)/.test(normalizedType)
  ) {
    family = "human";
  } else if (
    normalizedCategory.includes("flow") ||
    normalizedCategory.includes("logic") ||
    /(condition|switch|loop|parallel|branch|if)/.test(normalizedType)
  ) {
    family = "flow";
  } else if (
    normalizedCategory.includes("integration") ||
    normalizedCategory.includes("connector") ||
    normalizedSource === "connector" ||
    /(http|database|file|webhook)/.test(normalizedType)
  ) {
    family = "app";
  }

  const strokeWidth = 1.8;

  switch (family) {
    case "trigger":
      return <Zap size={size} strokeWidth={strokeWidth} />;
    case "ai":
      return <Sparkles size={size} strokeWidth={strokeWidth} />;
    case "human":
      return <User size={size} strokeWidth={strokeWidth} />;
    case "flow":
      return <Workflow size={size} strokeWidth={strokeWidth} />;
    case "app":
      return <Blocks size={size} strokeWidth={strokeWidth} />;
    default:
      return <Box size={size} strokeWidth={strokeWidth} />;
  }
}
