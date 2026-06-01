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
  const normalizedType = typeName.toLowerCase();
  if (normalizedType.includes("sheets") || normalizedType.includes("google_sheets") || normalizedType.includes("google-sheets")) {
    return "bg-gradient-to-br from-[#eafaf1] to-[#cbf2db] text-[#107c41] border-[#a3e2bb] shadow-sm";
  }
  if (normalizedType.includes("slack")) {
    return "bg-gradient-to-br from-[#fbf5fc] to-[#f4e2f7] text-[#e01e5a] border-[#e8c0ed] shadow-sm";
  }
  if (normalizedType.includes("openai") || normalizedType.includes("llm_completion")) {
    return "bg-gradient-to-br from-[#f4fbf7] to-[#dcfce7] text-[#10b981] border-[#bbf7d0] shadow-sm";
  }
  if (normalizedType.includes("database") || normalizedType.includes("postgres") || normalizedType.includes("postgresql") || normalizedType.includes("database_query")) {
    return "bg-gradient-to-br from-[#eef2ff] to-[#e0e7ff] text-[#3b82f6] border-[#c7d2fe] shadow-sm";
  }

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
  const normalizedType = typeName.toLowerCase();

  const isGoogleSheets = normalizedType.includes("sheets") || normalizedType.includes("google_sheets") || normalizedType.includes("google-sheets");
  const isSlack = normalizedType.includes("slack");
  const isOpenAi = normalizedType.includes("openai") || normalizedType.includes("llm_completion");
  const isDatabase = normalizedType.includes("database") || normalizedType.includes("postgres") || normalizedType.includes("postgresql") || normalizedType.includes("database_query");

  return (
    <span
      className={`inline-flex items-center justify-center border ${containerSizeClass} ${nodeAccentClassName({
        category,
        kind,
        source,
        typeName
      })} ${className} transition-all duration-300 ease-out group-hover:scale-105 group-hover:shadow-md backdrop-blur-sm`}
    >
      {isGoogleSheets ? (
        <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} className="drop-shadow-sm">
          <rect x="3" y="3" width="18" height="18" rx="3.5" fill="#107C41" />
          <path d="M7 8.5h10M7 12h10M7 15.5h10" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
          <rect x="11.2" y="6" width="1.6" height="12" fill="#FFFFFF" opacity="0.3" />
        </svg>
      ) : isSlack ? (
        <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} className="drop-shadow-sm" fill="none" fillRule="evenodd">
          {/* Top Left - Blue */}
          <path d="M5.04 15.17a2.52 2.52 0 1 1-2.52 2.52h2.52v-2.52z" fill="#36C5F0" />
          <path d="M6.3 15.17a2.52 2.52 0 0 1 2.52-2.52h5.04a2.52 2.52 0 0 1 2.52 2.52v5.04a2.52 2.52 0 0 1-2.52 2.52H8.82a2.52 2.52 0 0 1-2.52-2.52v-5.04z" fill="#36C5F0" />
          {/* Top Right - Green */}
          <path d="M8.82 5.04A2.52 2.52 0 1 1 6.3 2.52v2.52h2.52z" fill="#2EB67D" />
          <path d="M8.82 6.3a2.52 2.52 0 0 1 2.52 2.52v5.04a2.52 2.52 0 0 1-2.52 2.52H3.78a2.52 2.52 0 0 1-2.52-2.52V8.82a2.52 2.52 0 0 1 2.52-2.52h5.04z" fill="#2EB67D" />
          {/* Bottom Right - Red */}
          <path d="M18.96 8.82a2.52 2.52 0 1 1 2.52-2.52h-2.52v2.52z" fill="#E01E5A" />
          <path d="M17.7 8.82a2.52 2.52 0 0 1-2.52 2.52h-5.04a2.52 2.52 0 0 1-2.52-2.52V3.78a2.52 2.52 0 0 1 2.52-2.52h5.04a2.52 2.52 0 0 1 2.52 2.52v5.04z" fill="#E01E5A" />
          {/* Bottom Left - Yellow */}
          <path d="M15.17 18.96a2.52 2.52 0 1 1 2.52-2.52v2.52h-2.52z" fill="#ECB22E" />
          <path d="M15.17 17.7a2.52 2.52 0 0 1-2.52-2.52v-5.04a2.52 2.52 0 0 1 2.52-2.52h5.04a2.52 2.52 0 0 1 2.52 2.52v5.04a2.52 2.52 0 0 1-2.52 2.52h-5.04z" fill="#ECB22E" />
        </svg>
      ) : isOpenAi ? (
        <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} className="drop-shadow-sm">
          <path d="M21.3 10.1a5.6 5.6 0 0 0-2.4-3.3 5.7 5.7 0 0 0-5.7-.3L10.6 8 8.1 6.5a5.7 5.7 0 0 0-5.7.3 5.6 5.6 0 0 0-2.4 3.3 5.6 5.6 0 0 0 .9 4.1c.9 1.3 2.3 2.2 3.8 2.5l2.6 1.5 2.5 1.5a5.7 5.7 0 0 0 5.7-.3 5.6 5.6 0 0 0 2.4-3.3 5.6 5.6 0 0 0-.9-4.1zm-8.8 8.2c-.8.5-1.8.6-2.6.2l-4.2-2.4a3.8 3.8 0 0 1-1.6-2.2 3.8 3.8 0 0 1 .6-2.8l2.6 1.5 4.2 2.4c.8.5 1.3 1.4 1.3 2.3v1.2zm1-2.9l-4.2-2.4a3.8 3.8 0 0 1-1.6-2.2 3.8 3.8 0 0 1 .6-2.8 3.8 3.8 0 0 1 2.6-.2l4.2 2.4v5.2zm4.1-1.7l-2.6-1.5V10c0-.9-.5-1.8-1.3-2.3l-4.2-2.4c.8-.5 1.8-.6 2.6-.2l4.2 2.4a3.8 3.8 0 0 1 1.6 2.2 3.8 3.8 0 0 1-.9 2.8z" fill="#10A37F" />
        </svg>
      ) : isDatabase ? (
        <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} className="drop-shadow-sm">
          <ellipse cx="12" cy="5" rx="9" ry="3" fill="#336791" opacity="0.8" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" stroke="#336791" strokeWidth="2" fill="none" />
          <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" stroke="#336791" strokeWidth="2" fill="none" />
        </svg>
      ) : family === "trigger" ? (
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
