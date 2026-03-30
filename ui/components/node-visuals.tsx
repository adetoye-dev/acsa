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
  lg: "h-14 w-14 rounded-[13px]"
} as const;

const ICON_SIZE_CLASS = {
  sm: "h-[17px] w-[17px]",
  md: "h-[22px] w-[22px]",
  lg: "h-[36px] w-[36px]"
} as const;

export function nodeAccentClassName({
  category,
  kind,
  source,
  typeName
}: Omit<NodeGlyphProps, "className">) {
  switch (resolveNodeFamily({ category, kind, source, typeName })) {
    case "trigger":
      return "bg-[#eefaf3] text-[#2fa36b] border-[#caecd8]";
    case "ai":
      return "bg-[#f3f0ff] text-[#6f63ff] border-[#ddd4ff]";
    case "human":
      return "bg-[#fff3e7] text-[#c98632] border-[#f3d9b5]";
    case "flow":
      return "bg-[#eef6ff] text-[#4d78cc] border-[#d7e6ff]";
    case "app":
      return "bg-[#eef9f7] text-[#2f8f7b] border-[#cfe9e2]";
    case "core":
    default:
      return "bg-[#f5f6f8] text-[#5c6470] border-[#e1e4e8]";
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
  const iconSizeClass = ICON_SIZE_CLASS[size];

  return (
    <span
      className={`inline-flex items-center justify-center border ${containerSizeClass} ${nodeAccentClassName({
        category,
        kind,
        source,
        typeName
      })} ${className}`}
    >
      {family === "trigger" ? (
        <svg aria-hidden="true" className={iconSizeClass} fill="none" viewBox="0 0 20 20">
          <path
            d="M11.5 2.5L6.5 10h3l-1 7.5 5-7.5h-3l1-7.5Z"
            fill="currentColor"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="0.6"
          />
        </svg>
      ) : family === "ai" ? (
        <svg aria-hidden="true" className={iconSizeClass} fill="none" viewBox="0 0 20 20">
          <rect x="5" y="6" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 3.5v2M7 15.5V17M13 15.5V17M3.5 10H5M15 10h1.5M7.5 9.5h.01M12.5 9.5h.01M8 12.25h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
        </svg>
      ) : family === "human" ? (
        <svg aria-hidden="true" className={iconSizeClass} fill="none" viewBox="0 0 20 20">
          <path d="M10 10.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4.5 16a5.5 5.5 0 0 1 11 0" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
        </svg>
      ) : family === "flow" ? (
        <svg aria-hidden="true" className={iconSizeClass} fill="none" viewBox="0 0 20 20">
          <path d="M5 4.5h3v3H5zM12 4.5h3v3h-3zM12 12.5h3v3h-3z" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 6h4M13.5 7.5v5M8 6v0" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
        </svg>
      ) : family === "app" ? (
        <svg aria-hidden="true" className={iconSizeClass} fill="none" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="5.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4.5 10h11M10 4.5c1.5 1.6 2.3 3.43 2.3 5.5 0 2.07-.8 3.9-2.3 5.5M10 4.5C8.5 6.1 7.7 7.93 7.7 10c0 2.07.8 3.9 2.3 5.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" />
        </svg>
      ) : (
        <svg aria-hidden="true" className={iconSizeClass} fill="none" viewBox="0 0 20 20">
          <path d="M7.25 5.5 4.5 10l2.75 4.5M12.75 5.5 15.5 10l-2.75 4.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
        </svg>
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
