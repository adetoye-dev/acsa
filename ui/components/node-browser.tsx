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

import { useEffect, useMemo, useRef, useState } from "react";

import type { StepTypeEntry } from "../lib/workflow-editor";
import {
  NodeGlyph,
  nodeAccentClassName
} from "./node-visuals";

type NodeBrowserProps = {
  contextHint?: string | null;
  onClose: () => void;
  onSelectType: (typeName: string) => void;
  stepCatalog: StepTypeEntry[];
};

const RECENT_STEP_TYPES_KEY = "acsa.node-browser.recent-step-types";
const MAX_RECENT_TYPES = 6;
const SUGGESTED_TYPE_NAMES = [
  "http_request",
  "llm_completion",
  "condition",
  "file_write",
  "approval",
  "parallel"
];

export function NodeBrowser({
  contextHint,
  onClose,
  onSelectType,
  stepCatalog
}: NodeBrowserProps) {
  const [search, setSearch] = useState("");
  const [highlightedTypeName, setHighlightedTypeName] = useState<string | null>(null);
  const [recentTypeNames, setRecentTypeNames] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return stepCatalog;
    }
    return stepCatalog.filter((entry) =>
      [entry.label, entry.type_name, entry.description, entry.category, entry.source]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [search, stepCatalog]);

  const filteredEntryLookup = useMemo(
    () => new Map(filteredEntries.map((entry) => [entry.type_name, entry])),
    [filteredEntries]
  );

  const recentEntries = useMemo(
    () =>
      recentTypeNames
        .map((typeName) => filteredEntryLookup.get(typeName))
        .filter((entry): entry is StepTypeEntry => Boolean(entry)),
    [filteredEntryLookup, recentTypeNames]
  );

  const suggestedEntries = useMemo(() => {
    const preferredEntries = SUGGESTED_TYPE_NAMES.map((typeName) =>
      filteredEntryLookup.get(typeName)
    ).filter((entry): entry is StepTypeEntry => Boolean(entry));

    if (preferredEntries.length > 0) {
      return preferredEntries.filter(
        (entry) => !recentEntries.some((recent) => recent.type_name === entry.type_name)
      );
    }

    return filteredEntries
      .slice(0, 6)
      .filter(
        (entry) => !recentEntries.some((recent) => recent.type_name === entry.type_name)
      );
  }, [filteredEntries, filteredEntryLookup, recentEntries]);

  const groupedEntries = useMemo(() => {
    return Array.from(
      filteredEntries.reduce((groups, entry) => {
        const category = entry.category || "core";
        const bucket = groups.get(category) ?? [];
        bucket.push(entry);
        groups.set(category, bucket);
        return groups;
      }, new Map<string, StepTypeEntry[]>())
    ).sort(([left], [right]) => left.localeCompare(right));
  }, [filteredEntries]);

  const visibleTypeNames = useMemo(() => {
    if (!search.trim()) {
      const orderedTypes = [
        ...recentEntries.map((entry) => entry.type_name),
        ...suggestedEntries.map((entry) => entry.type_name),
        ...groupedEntries.flatMap(([, entries]) => entries.map((entry) => entry.type_name))
      ];
      return Array.from(new Set(orderedTypes));
    }

    return filteredEntries.map((entry) => entry.type_name);
  }, [filteredEntries, groupedEntries, recentEntries, search, suggestedEntries]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RECENT_STEP_TYPES_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }
      setRecentTypeNames(
        parsed.filter((value): value is string => typeof value === "string")
      );
    } catch {
      setRecentTypeNames([]);
    }
  }, []);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!visibleTypeNames.length) {
      setHighlightedTypeName(null);
      return;
    }

    setHighlightedTypeName((current) =>
      current && visibleTypeNames.includes(current) ? current : visibleTypeNames[0]
    );
  }, [visibleTypeNames]);

  useEffect(() => {
    if (!highlightedTypeName) {
      return;
    }

    const element = document.getElementById(optionId(highlightedTypeName));
    element?.scrollIntoView({ block: "nearest" });
  }, [highlightedTypeName]);

  function rememberRecentType(typeName: string) {
    const nextRecentTypes = [
      typeName,
      ...recentTypeNames.filter((candidate) => candidate !== typeName)
    ].slice(0, MAX_RECENT_TYPES);
    setRecentTypeNames(nextRecentTypes);
    try {
      window.localStorage.setItem(
        RECENT_STEP_TYPES_KEY,
        JSON.stringify(nextRecentTypes)
      );
    } catch {
      // Ignore storage failures in private or locked-down browsing contexts.
    }
  }

  function handleSelect(typeName: string) {
    rememberRecentType(typeName);
    onSelectType(typeName);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement | HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (!visibleTypeNames.length) {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const currentIndex = highlightedTypeName
        ? visibleTypeNames.indexOf(highlightedTypeName)
        : -1;
      const nextIndex =
        event.key === "ArrowDown"
          ? (currentIndex + 1 + visibleTypeNames.length) % visibleTypeNames.length
          : (currentIndex - 1 + visibleTypeNames.length) % visibleTypeNames.length;
      setHighlightedTypeName(visibleTypeNames[nextIndex]);
      return;
    }

    if (event.key === "Enter" && highlightedTypeName) {
      event.preventDefault();
      handleSelect(highlightedTypeName);
    }
  }

  return (
    <div
      className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto]"
      onKeyDown={handleKeyDown}
    >
      <div className="border-b border-black/10 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate/60">
              Step library
            </div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-ink">
              Add a step
            </div>
            {contextHint ? (
              <div className="mt-1 text-xs text-slate">{contextHint}</div>
            ) : null}
          </div>
          <button
            aria-label="Close node browser"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-white/72 text-slate/70 transition hover:border-black/20 hover:bg-white"
            onClick={onClose}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className="border-b border-black/10 px-4 py-4">
        <label className="sr-only" htmlFor="node-browser-search">
          Search nodes
        </label>
        <input
          className="ui-input"
          id="node-browser-search"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search steps, actions, and categories"
          ref={searchInputRef}
          type="search"
          value={search}
        />
      </div>

      <div className="sleek-scroll min-h-0 overflow-y-auto px-3 py-3">
        {search.trim().length === 0 && recentEntries.length > 0 ? (
          <section className="mb-5">
            <SectionHeader
              accentClassName="bg-[#5e86ff]"
              count={recentEntries.length}
              title="Recent"
            />
            <div className="space-y-2">
              {recentEntries.map((entry) => (
                <NodeOption
                  entry={entry}
                  highlighted={highlightedTypeName === entry.type_name}
                  key={entry.type_name}
                  onHover={() => setHighlightedTypeName(entry.type_name)}
                  onSelect={() => handleSelect(entry.type_name)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {search.trim().length === 0 && suggestedEntries.length > 0 ? (
          <section className="mb-5">
            <SectionHeader
              accentClassName="bg-[#f0a15e]"
              count={suggestedEntries.length}
              title="Suggested"
            />
            <div className="space-y-2">
              {suggestedEntries.map((entry) => (
                <NodeOption
                  entry={entry}
                  highlighted={highlightedTypeName === entry.type_name}
                  key={entry.type_name}
                  onHover={() => setHighlightedTypeName(entry.type_name)}
                  onSelect={() => handleSelect(entry.type_name)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {groupedEntries.length > 0 ? (
          groupedEntries.map(([category, entries]) => (
            <section key={category} className="mb-5">
              <SectionHeader
                accentClassName={categoryAccentClassName(category)}
                count={entries.length}
                title={titleCase(category)}
              />

              <div className="space-y-2">
                {entries.map((entry) => (
                  <NodeOption
                    entry={entry}
                    highlighted={highlightedTypeName === entry.type_name}
                    key={entry.type_name}
                    onHover={() => setHighlightedTypeName(entry.type_name)}
                    onSelect={() => handleSelect(entry.type_name)}
                  />
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-black/10 bg-white/68 px-4 py-8 text-center text-sm leading-6 text-slate">
            No node matched your search. Try a broader keyword like <span className="font-medium text-ink">http</span>, <span className="font-medium text-ink">ai</span>, or <span className="font-medium text-ink">flow</span>.
          </div>
        )}
      </div>

      <div className="border-t border-black/10 px-4 py-3">
        <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.16em] text-slate/55">
          <span>steps only</span>
          <span>↑ ↓ navigate • enter add • esc close</span>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  accentClassName,
  count,
  title
}: {
  accentClassName: string;
  count: number;
  title: string;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 px-1">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${accentClassName}`} />
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/60">
          {title}
        </div>
      </div>
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate/55">
        {count}
      </span>
    </div>
  );
}

function NodeOption({
  entry,
  highlighted,
  onHover,
  onSelect
}: {
  entry: StepTypeEntry;
  highlighted: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  return (
    <button
      className={`group flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition ${
        highlighted
          ? "border-[#7c8fff]/24 bg-[#f7f9ff] shadow-[0_10px_24px_rgba(94,134,255,0.08)]"
          : "border-black/10 bg-white/74 hover:border-[#7c8fff]/18 hover:bg-white"
      }`}
      id={optionId(entry.type_name)}
      onClick={onSelect}
      onFocus={onHover}
      onMouseEnter={onHover}
      type="button"
    >
      <NodeGlyph
        category={entry.category}
        className="shrink-0"
        kind="step"
        source={entry.source}
        typeName={entry.type_name}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink">{entry.label}</div>
            <div className="mt-1 truncate text-xs leading-5 text-slate">
              {entry.description}
            </div>
          </div>
          <span
            className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${nodeAccentClassName({
              category: entry.category,
              kind: "step",
              source: entry.source,
              typeName: entry.type_name
            })}`}
          >
            {entry.runtime ?? entry.source}
          </span>
        </div>
      </div>
    </button>
  );
}

function categoryAccentClassName(category: string) {
  switch (category.toLowerCase()) {
    case "ai":
      return "bg-[#7c8fff]";
    case "human":
      return "bg-[#f0a15e]";
    case "flow":
    case "logic":
      return "bg-[#9a72ff]";
    case "integration":
    case "connector":
      return "bg-[#45c5b6]";
    default:
      return "bg-[#7b879a]";
  }
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 16 16">
      <path d="m4 4 8 8M12 4 4 12" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  );
}

function optionId(typeName: string) {
  return `node-browser-option-${typeName.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}
