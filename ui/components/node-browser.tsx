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

import {
  semanticCategoryDescription,
  semanticCategoryLabel
} from "../lib/semantic-labels";
import type { StepTypeEntry } from "../lib/workflow-editor";
import { NodeGlyph } from "./node-visuals";

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

  const activeHighlightedTypeName = useMemo(() => {
    if (!visibleTypeNames.length) {
      return null;
    }

    return highlightedTypeName && visibleTypeNames.includes(highlightedTypeName)
      ? highlightedTypeName
      : visibleTypeNames[0];
  }, [highlightedTypeName, visibleTypeNames]);

  useEffect(function hydrateRecentStepTypesEffect() {
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

  useEffect(function focusNodeBrowserSearchEffect() {
    searchInputRef.current?.focus();
  }, []);

  useEffect(function keepHighlightedOptionInViewEffect() {
    if (!activeHighlightedTypeName) {
      return;
    }

    const element = document.getElementById(optionId(activeHighlightedTypeName));
    element?.scrollIntoView({ block: "nearest" });
  }, [activeHighlightedTypeName]);

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
      const currentIndex = activeHighlightedTypeName
        ? visibleTypeNames.indexOf(activeHighlightedTypeName)
        : -1;
      const nextIndex =
        event.key === "ArrowDown"
          ? (currentIndex + 1 + visibleTypeNames.length) % visibleTypeNames.length
          : (currentIndex - 1 + visibleTypeNames.length) % visibleTypeNames.length;
      setHighlightedTypeName(visibleTypeNames[nextIndex]);
      return;
    }

    if (event.key === "Enter" && activeHighlightedTypeName) {
      event.preventDefault();
      handleSelect(activeHighlightedTypeName);
    }
  }

  return (
    <div
      className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)]"
      onKeyDown={handleKeyDown}
    >
      <div className="border-b border-black/10 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate/60">
              Capability library
            </div>
            <div className="mt-1 text-[16px] font-medium tracking-tight text-ink">
              Choose what this step should do
            </div>
            {contextHint ? (
              <div className="mt-1 text-[12px] text-slate">{contextHint}</div>
            ) : null}
          </div>
          <button
            aria-label="Close node browser"
            className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-black/10 bg-white text-slate/70 transition hover:border-black/20 hover:bg-[#fafaf8]"
            onClick={onClose}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className="border-b border-black/10 px-4 py-3">
        <label className="sr-only" htmlFor="node-browser-search">
          Search capabilities
        </label>
        <input
          className="ui-input"
          id="node-browser-search"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search capabilities, apps, actions, and flow controls"
          ref={searchInputRef}
          type="search"
          value={search}
        />
      </div>

      <div className="sleek-scroll min-h-0 overflow-y-auto px-2.5 py-2.5">
        {search.trim().length === 0 && recentEntries.length > 0 ? (
          <section className="mb-4">
            <SectionHeader
              accentClassName="bg-[#6a727b]"
              count={recentEntries.length}
              description="Jump back into capabilities you have used lately."
              title="Recently used"
            />
            <div className="space-y-2">
              {recentEntries.map((entry) => (
                <NodeOption
                  entry={entry}
                  highlighted={activeHighlightedTypeName === entry.type_name}
                  key={entry.type_name}
                  onHover={() => setHighlightedTypeName(entry.type_name)}
                  onSelect={() => handleSelect(entry.type_name)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {search.trim().length === 0 && suggestedEntries.length > 0 ? (
          <section className="mb-4">
            <SectionHeader
              accentClassName="bg-[#8a8176]"
              count={suggestedEntries.length}
              description="Common starting points for new workflow steps."
              title="Good starting points"
            />
            <div className="space-y-2">
              {suggestedEntries.map((entry) => (
                <NodeOption
                  entry={entry}
                  highlighted={activeHighlightedTypeName === entry.type_name}
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
            <section key={category} className="mb-4">
              <SectionHeader
                accentClassName={categoryAccentClassName(category)}
                count={entries.length}
                description={semanticCategoryDescription(category)}
                title={semanticCategoryLabel(category)}
              />

              <div className="space-y-2">
                {entries.map((entry) => (
                  <NodeOption
                    entry={entry}
                    highlighted={activeHighlightedTypeName === entry.type_name}
                    key={entry.type_name}
                    onHover={() => setHighlightedTypeName(entry.type_name)}
                    onSelect={() => handleSelect(entry.type_name)}
                  />
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="rounded-[12px] border border-dashed border-black/10 bg-[#fbfbfa] px-4 py-8 text-center text-sm leading-6 text-slate">
            No capability matched your search. Try a broader keyword like{" "}
            <span className="font-medium text-ink">approval</span>,{" "}
            <span className="font-medium text-ink">email</span>, or{" "}
            <span className="font-medium text-ink">ai</span>.
          </div>
        )}
      </div>

    </div>
  );
}

function SectionHeader({
  accentClassName,
  count,
  description,
  title
}: {
  accentClassName: string;
  count: number;
  description?: string;
  title: string;
}) {
  return (
    <div className="mb-2 flex items-start justify-between gap-3 px-1">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${accentClassName}`} />
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/60">
            {title}
          </div>
        </div>
        {description ? (
          <div className="mt-1 text-[12px] leading-5 text-slate">{description}</div>
        ) : null}
      </div>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate/55">
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
      className={`group flex w-full items-start gap-3 rounded-[12px] border px-3 py-3 text-left transition ${
        highlighted
          ? "border-[#171b20]/18 bg-[#f5f5f2]"
          : "border-black/10 bg-white hover:border-black/20 hover:bg-[#fafaf8]"
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
            <div className="truncate text-sm font-medium text-ink">{entry.label}</div>
            <div className="mt-0.5 truncate text-[12px] leading-5 text-slate">
              {entry.description}
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center rounded-[8px] border border-black/10 bg-white px-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[#6a717a]">
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
      return "bg-[#5d6670]";
    case "human":
      return "bg-[#7b7166]";
    case "flow":
    case "logic":
      return "bg-[#6c737c]";
    case "integration":
    case "connector":
      return "bg-[#858c95]";
    default:
      return "bg-[#9ba1a8]";
  }
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
