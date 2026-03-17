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

import { useMemo, useState } from "react";

import type { StepTypeEntry } from "../lib/workflow-editor";
import {
  NodeGlyph,
  nodeAccentClassName
} from "./node-visuals";

type NodeBrowserProps = {
  onClose: () => void;
  onSelectType: (typeName: string) => void;
  stepCatalog: StepTypeEntry[];
};

export function NodeBrowser({
  onClose,
  onSelectType,
  stepCatalog
}: NodeBrowserProps) {
  const [search, setSearch] = useState("");

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

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)]">
      <div className="border-b border-black/10 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate/60">
              Node library
            </div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-ink">
              Add a step
            </div>
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
          placeholder="Search nodes, actions, and categories"
          type="search"
          value={search}
        />
      </div>

      <div className="sleek-scroll min-h-0 overflow-y-auto px-3 py-3">
        {groupedEntries.length > 0 ? (
          groupedEntries.map(([category, entries]) => (
            <section key={category} className="mb-5">
              <div className="mb-2 flex items-center justify-between gap-3 px-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${categoryAccentClassName(category)}`}
                  />
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/60">
                    {titleCase(category)}
                  </div>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate/55">
                  {entries.length}
                </span>
              </div>

              <div className="space-y-2">
                {entries.map((entry) => (
                  <button
                    key={entry.type_name}
                    className="group flex w-full items-start gap-3 rounded-2xl border border-black/10 bg-white/74 px-3 py-3 text-left transition hover:border-[#7c8fff]/22 hover:bg-white"
                    onClick={() => onSelectType(entry.type_name)}
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
                          <div className="truncate text-sm font-semibold text-ink">
                            {entry.label}
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate">
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
    </div>
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
