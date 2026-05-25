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

import { Zap, Sparkles, User, Workflow, Blocks, Box } from "lucide-react";

type NodeVisualKind = "step" | "trigger";

type NodeGlyphProps = {
  category?: string | null;
  className?: string;
  kind: NodeVisualKind;
  size?: "sm" | "md" | "lg";
  source?: string | null;
  typeName: string;
};

type NodeFamily = "ai" | "app" | "core" | "flow" | "human" | "trigger";

const CONTAINER_SIZE_CLASS = {
  sm: "h-8 w-8 rounded-[10px]",
  md: "h-10 w-10 rounded-[11px]",
  lg: "h-14 w-14 rounded-[14px]"
} as const;

const ICON_SIZE = {
  sm: 16,
  md: 20,
  lg: 26
} as const;

export function nodeAccentClassName({
  category,
  kind,
  source,
  typeName
}: Omit<NodeGlyphProps, "className">) {
  switch (resolveNodeFamily({ category, kind, source, typeName })) {
    case "trigger":
      return "bg-gradient-to-br from-[#eefaf3] to-[#d8f4e2] text-[#2fa36b] border-[#caecd8] shadow-sm";
    case "ai":
      return "bg-gradient-to-br from-[#f3f0ff] to-[#e7e1ff] text-[#6f63ff] border-[#ddd4ff] shadow-sm";
    case "human":
      return "bg-gradient-to-br from-[#fff3e7] to-[#ffe5cc] text-[#c98632] border-[#f3d9b5] shadow-sm";
    case "flow":
      return "bg-gradient-to-br from-[#eef6ff] to-[#d9eaff] text-[#4d78cc] border-[#d7e6ff] shadow-sm";
    case "app":
      return "bg-gradient-to-br from-[#eef9f7] to-[#d8f3ec] text-[#2f8f7b] border-[#cfe9e2] shadow-sm";
    case "core":
    default:
      return "bg-gradient-to-br from-[#f5f6f8] to-[#eaecf0] text-[#5c6470] border-[#e1e4e8] shadow-sm";
  }
}

export function NodeGlyph({
  category,
  className = "",
  kind,
  size = "md",
  source,
  typeName
}: NodeGlyphProps) {
  const family = resolveNodeFamily({ category, kind, source, typeName });
  const containerSizeClass = CONTAINER_SIZE_CLASS[size];
  const iconSize = ICON_SIZE[size];

  return (
    <span
      className={`inline-flex items-center justify-center border ${containerSizeClass} ${nodeAccentClassName({
        category,
        kind,
        source,
        typeName
      })} ${className} transition-all duration-300 ease-out group-hover:scale-105 group-hover:shadow-md backdrop-blur-sm`}
    >
      {family === "trigger" ? (
        <Zap size={iconSize} strokeWidth={1.8} className="drop-shadow-sm" />
      ) : family === "ai" ? (
        <Sparkles size={iconSize} strokeWidth={1.8} className="drop-shadow-sm" />
      ) : family === "human" ? (
        <User size={iconSize} strokeWidth={1.8} className="drop-shadow-sm" />
      ) : family === "flow" ? (
        <Workflow size={iconSize} strokeWidth={1.8} className="drop-shadow-sm" />
      ) : family === "app" ? (
        <Blocks size={iconSize} strokeWidth={1.8} className="drop-shadow-sm" />
      ) : (
        <Box size={iconSize} strokeWidth={1.8} className="drop-shadow-sm" />
      )}
    </span>
  );
}

function resolveNodeFamily({
  category,
  kind,
  source,
  typeName
}: Omit<NodeGlyphProps, "className">): NodeFamily {
  const normalizedCategory = (category ?? "").toLowerCase();
  const normalizedType = typeName.toLowerCase();
  const normalizedSource = (source ?? "").toLowerCase();

  if (kind === "trigger" || normalizedCategory === "trigger") {
    return "trigger";
  }
  if (
    normalizedCategory.includes("ai") ||
    /(llm|embedding|retrieval|classification|extraction|agent|model)/.test(normalizedType)
  ) {
    return "ai";
  }
  if (
    normalizedCategory.includes("human") ||
    /(approval|manual_input|human)/.test(normalizedType)
  ) {
    return "human";
  }
  if (
    normalizedCategory.includes("flow") ||
    normalizedCategory.includes("logic") ||
    /(condition|switch|loop|parallel|branch|if)/.test(normalizedType)
  ) {
    return "flow";
  }
  if (
    normalizedCategory.includes("integration") ||
    normalizedCategory.includes("connector") ||
    normalizedSource === "connector" ||
    /(http|database|file|webhook)/.test(normalizedType)
  ) {
    return "app";
  }
  return "core";
}
