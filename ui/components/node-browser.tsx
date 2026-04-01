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
import { applyNodeAssetUpdate, upsertNodeRecord } from "../lib/node-records";
import type { StepTypeEntry } from "../lib/workflow-editor";
import { NodeGlyph } from "./node-visuals";

type NodeBrowserProps = {
  autoFocusSearch?: boolean;
  contextHint?: string | null;
  onClose?: () => void;
  onNodeRecordSaved?: (typeName: string) => Promise<void> | void;
  onSelectType: (typeName: string) => void;
  stepCatalog: StepTypeEntry[];
  subtitle?: string;
  title?: string;
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
  autoFocusSearch = true,
  contextHint,
  onClose,
  onNodeRecordSaved,
  onSelectType,
  stepCatalog,
  subtitle = "Choose what this step should do",
  title = "Capability library"
}: NodeBrowserProps) {
  const [search, setSearch] = useState("");
  const [highlightedTypeName, setHighlightedTypeName] = useState<string | null>(null);
  const [editingTypeName, setEditingTypeName] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [editingBaseTypeName, setEditingBaseTypeName] = useState("noop");
  const [editError, setEditError] = useState<string | null>(null);
  const [isApplyingUpdate, setIsApplyingUpdate] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
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

  const editingEntry = useMemo(
    () => stepCatalog.find((entry) => entry.type_name === editingTypeName) ?? null,
    [editingTypeName, stepCatalog]
  );

  const baseTypeOptions = useMemo(
    () => stepCatalog.filter((entry) => entry.type_name !== editingTypeName),
    [editingTypeName, stepCatalog]
  );

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
    if (!autoFocusSearch) {
      return;
    }
    searchInputRef.current?.focus();
  }, [autoFocusSearch]);

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

  function handleEdit(entry: StepTypeEntry) {
    setEditingTypeName(entry.type_name);
    setEditingLabel(entry.label);
    setEditingDescription(entry.description);
    setEditingBaseTypeName(entry.app_record?.base_type_name ?? "noop");
    setEditError(null);
  }

  function handleCancelEdit() {
    setEditingTypeName(null);
    setEditingLabel("");
    setEditingDescription("");
    setEditingBaseTypeName("noop");
    setEditError(null);
  }

  async function handleSaveEdit() {
    if (!editingEntry || isSavingEdit || !editingEntry.app_record) {
      return;
    }

    setIsSavingEdit(true);
    setEditError(null);
    try {
      await upsertNodeRecord({
        base_type_name: editingBaseTypeName,
        category: editingEntry.category,
        description: editingDescription.trim(),
        label: editingLabel.trim(),
        source_kind: editingEntry.app_record.source_kind,
        source_ref: editingEntry.app_record.source_ref,
        type_name: editingEntry.type_name
      });
      await onNodeRecordSaved?.(editingEntry.type_name);
      handleCancelEdit();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Failed to save node");
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleApplyUpdate(typeName: string) {
    setIsApplyingUpdate(typeName);
    setEditError(null);
    try {
      await applyNodeAssetUpdate(typeName);
      await onNodeRecordSaved?.(typeName);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Failed to apply update");
    } finally {
      setIsApplyingUpdate(null);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement | HTMLInputElement>) {
    if (event.key === "Escape") {
      if (!onClose) {
        return;
      }
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
              {title}
            </div>
            <div className="mt-1 text-[16px] font-medium tracking-tight text-ink">
              {subtitle}
            </div>
            {contextHint ? (
              <div className="mt-1 text-[12px] text-slate">{contextHint}</div>
            ) : null}
          </div>
          {onClose ? (
            <button
              aria-label="Close node browser"
              className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-black/10 bg-white text-slate/70 transition hover:border-black/20 hover:bg-[#fafaf8]"
              onClick={onClose}
              type="button"
            >
              <CloseIcon />
            </button>
          ) : null}
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

      {editingEntry ? (
        <div className="border-b border-black/10 bg-[#fbfbfa] px-4 py-3">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/58">
                Edit node
              </div>
              <div className="mt-1 text-[14px] font-medium tracking-tight text-ink">
                {editingEntry.type_name}
              </div>
            </div>
            <button
              className="ui-button"
              onClick={handleCancelEdit}
              type="button"
            >
              Cancel
            </button>
          </div>

          <div className="grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/58">
                Label
              </span>
              <input
                className="ui-input"
                onChange={(event) => setEditingLabel(event.target.value)}
                value={editingLabel}
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/58">
                Description
              </span>
              <textarea
                className="ui-input min-h-[92px] resize-y"
                onChange={(event) => setEditingDescription(event.target.value)}
                value={editingDescription}
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/58">
                Base step
              </span>
              <select
                className="ui-input"
                onChange={(event) => setEditingBaseTypeName(event.target.value)}
                value={editingBaseTypeName}
              >
                <option value="noop">Pass through</option>
                {baseTypeOptions.map((entry) => (
                  <option key={entry.type_name} value={entry.type_name}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-2">
              <button
                className="ui-button ui-button-primary"
                disabled={
                  isSavingEdit ||
                  !editingLabel.trim() ||
                  !editingDescription.trim() ||
                  !editingBaseTypeName.trim()
                }
                onClick={() => void handleSaveEdit()}
                type="button"
              >
                {isSavingEdit ? "Saving…" : "Save changes"}
              </button>
            </div>

            {editError ? (
              <p className="text-[12px] leading-5 text-[#c65a72]">{editError}</p>
            ) : null}
          </div>
        </div>
      ) : null}

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
                  applyUpdateDisabled={Boolean(isApplyingUpdate)}
                  applyUpdateBusy={isApplyingUpdate === entry.type_name}
                  entry={entry}
                  highlighted={activeHighlightedTypeName === entry.type_name}
                  key={entry.type_name}
                  onApplyUpdate={() => void handleApplyUpdate(entry.type_name)}
                  onEdit={() => handleEdit(entry)}
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
                  applyUpdateDisabled={Boolean(isApplyingUpdate)}
                  applyUpdateBusy={isApplyingUpdate === entry.type_name}
                  entry={entry}
                  highlighted={activeHighlightedTypeName === entry.type_name}
                  key={entry.type_name}
                  onApplyUpdate={() => void handleApplyUpdate(entry.type_name)}
                  onEdit={() => handleEdit(entry)}
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
                    applyUpdateDisabled={Boolean(isApplyingUpdate)}
                    applyUpdateBusy={isApplyingUpdate === entry.type_name}
                    entry={entry}
                    highlighted={activeHighlightedTypeName === entry.type_name}
                    key={entry.type_name}
                    onApplyUpdate={() => void handleApplyUpdate(entry.type_name)}
                    onEdit={() => handleEdit(entry)}
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
  applyUpdateDisabled,
  applyUpdateBusy,
  entry,
  highlighted,
  onApplyUpdate,
  onEdit,
  onHover,
  onSelect
}: {
  applyUpdateDisabled: boolean;
  applyUpdateBusy: boolean;
  entry: StepTypeEntry;
  highlighted: boolean;
  onApplyUpdate: () => void;
  onEdit: () => void;
  onHover: () => void;
  onSelect: () => void;
}) {
  const isEditable =
    entry.app_record?.source_kind === "generated" || entry.app_record?.source_kind === "custom";
  const hasUpdate =
    !!entry.app_record?.available_version &&
    entry.app_record.available_version !== entry.app_record.installed_version;
  const canApplyUpdate =
    entry.app_record?.source_kind === "shipped" &&
    hasUpdate &&
    !(entry.app_record.is_locally_modified ?? false);

  return (
    <div
      className={`group flex items-start gap-2 rounded-[12px] border px-2 py-2 transition ${
        highlighted
          ? "border-[#171b20]/18 bg-[#f5f5f2]"
          : "border-black/10 bg-white hover:border-black/20 hover:bg-[#fafaf8]"
      }`}
      onMouseEnter={onHover}
    >
      <button
        className="flex min-w-0 flex-1 items-start gap-3 rounded-[10px] px-1 py-1 text-left"
        id={optionId(entry.type_name)}
        onClick={onSelect}
        onFocus={onHover}
        type="button"
      >
        <NodeGlyph
          category={entry.category}
          className="shrink-0"
          kind="step"
          size="sm"
          source={entry.source}
          typeName={entry.type_name}
        />
        <div className="min-w-0 flex-1">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-medium text-ink">{entry.label}</div>
              {entry.app_record ? (
                <span className="rounded-md bg-[#f3f0ff] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#6f63ff]">
                  {entry.app_record.source_kind === "generated"
                    ? "Generated"
                    : entry.app_record.source_kind === "custom"
                      ? "Custom"
                      : "Shipped"}
                </span>
              ) : null}
              {entry.app_record?.is_locally_modified ? (
                <span className="rounded-md bg-[#f7f2e8] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#8a6b2f]">
                  Locally modified
                </span>
              ) : null}
              {hasUpdate ? (
                <span className="rounded-md bg-[#eef6ff] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#4b6fd8]">
                  Update available
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 truncate text-[12px] leading-5 text-slate">
              {entry.description}
            </div>
          </div>
        </div>
      </button>
      <div className="flex items-center gap-2">
        {canApplyUpdate ? (
          <button
            className="ui-button !px-2.5 !py-1.5"
            disabled={applyUpdateDisabled}
            onClick={onApplyUpdate}
            type="button"
          >
            {applyUpdateBusy ? "Updating…" : "Update"}
          </button>
        ) : null}
        {isEditable ? (
          <button
            className="ui-button !px-2.5 !py-1.5"
            onClick={onEdit}
            type="button"
          >
            Edit
          </button>
        ) : null}
      </div>
    </div>
  );
}

function categoryAccentClassName(category: string) {
  switch (category.toLowerCase()) {
    case "ai":
      return "bg-[#5d6670]";
    case "apps":
    case "integration":
    case "connector":
      return "bg-[#858c95]";
    case "core":
    case "data":
      return "bg-[#76808a]";
    case "human":
      return "bg-[#7b7166]";
    case "flow":
    case "logic":
      return "bg-[#6c737c]";
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
