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

import { useMemo, useState } from "react";

import type { StepTypeEntry } from "../lib/workflow-editor";
import {
  deriveGeneratedNodeIdentity,
  upsertNodeRecord
} from "../lib/node-records";
import { NodeGlyph } from "./node-visuals";

const EXAMPLE_PROMPTS = [
  "When I receive a webhook, validate the payload and send Slack updates.",
  "Every day at 9am, fetch data from an API and email me the summary.",
  "Pause the workflow for approval before sending the final message."
] as const;

type AiAssistantRailProps = {
  onClose?: () => void;
  onNodeRecordSaved?: () => Promise<void> | void;
  onSelectType: (typeName: string) => void;
  stepCatalog: StepTypeEntry[];
};

export function AiAssistantRail({
  onClose,
  onNodeRecordSaved,
  onSelectType,
  stepCatalog
}: AiAssistantRailProps) {
  const [prompt, setPrompt] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNodeLabel, setSavedNodeLabel] = useState<string | null>(null);
  const [isSavingNode, setIsSavingNode] = useState(false);

  const suggestions = useMemo(() => {
    const query = prompt.trim().toLowerCase();
    if (!query) {
      return [];
    }

    const tokens = query
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter(Boolean);

    return stepCatalog
      .map((entry) => ({
        entry,
        score: scoreStepSuggestion(entry, tokens)
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.entry.label.localeCompare(right.entry.label))
      .slice(0, 6)
      .map((candidate) => candidate.entry);
  }, [prompt, stepCatalog]);

  async function handleSaveGeneratedNode() {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || isSavingNode) {
      return;
    }

    const identity = deriveGeneratedNodeIdentity(trimmedPrompt, "Generated step");
    setIsSavingNode(true);
    setSaveError(null);
    setSavedNodeLabel(null);

    try {
      const record = await upsertNodeRecord({
        category: "Apps",
        description: trimmedPrompt,
        label: identity.label,
        source_kind: "generated",
        source_ref: trimmedPrompt,
        type_name: identity.type_name
      });
      await onNodeRecordSaved?.();
      setSavedNodeLabel(record.label);
    } catch (nextError) {
      setSaveError(
        nextError instanceof Error ? nextError.message : "Failed to save generated node"
      );
    } finally {
      setIsSavingNode(false);
    }
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] border-l border-black/10 bg-[rgba(252,252,253,0.96)]">
      <div className="border-b border-black/10 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[10px] bg-[#f3f0ff] text-[#6f63ff]">
              <AssistantIcon />
            </span>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/58">
                Assistant
              </div>
              <div className="mt-0.5 text-[14px] font-medium tracking-tight text-ink">
                Describe the workflow
              </div>
            </div>
          </div>
          {onClose ? (
            <button
              aria-label="Close assistant"
              className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-black/10 bg-white text-slate/70 transition hover:border-black/16 hover:bg-[#fafafb] hover:text-ink"
              onClick={onClose}
              type="button"
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>
      </div>

      <div className="sleek-scroll min-h-0 overflow-y-auto px-4 py-4">
        <div className="space-y-4">
          <div className="rounded-[16px] border border-black/10 bg-white px-4 py-4">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/58" htmlFor="workflow-assistant-prompt">
              Workflow brief
            </label>
            <textarea
              className="ui-input min-h-[118px] resize-none leading-6"
              id="workflow-assistant-prompt"
              onChange={(event) => {
                setPrompt(event.target.value);
                setSaveError(null);
                setSavedNodeLabel(null);
              }}
              placeholder="Describe what should happen and the assistant will suggest likely steps from your installed library."
              value={prompt}
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                className="ui-button"
                disabled={isSavingNode || !prompt.trim()}
                onClick={() => void handleSaveGeneratedNode()}
                type="button"
              >
                {isSavingNode ? "Saving…" : "Save generated node"}
              </button>
              {savedNodeLabel ? (
                <span className="text-[12px] leading-5 text-[#4f5964]">
                  Saved as {savedNodeLabel}.
                </span>
              ) : null}
            </div>
            {saveError ? (
              <p className="mt-2 text-[12px] leading-5 text-[#c65a72]">{saveError}</p>
            ) : null}
          </div>

          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/58">
              Try these prompts
            </div>
            <div className="space-y-2">
              {EXAMPLE_PROMPTS.map((example) => (
                <button
                  className="w-full rounded-[14px] border border-black/10 bg-white px-3 py-3 text-left text-sm leading-6 text-slate transition hover:border-black/16 hover:bg-[#fbfbfc]"
                  key={example}
                  onClick={() => setPrompt(example)}
                  type="button"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/58">
                Suggested steps
              </div>
              {suggestions.length > 0 ? (
                <span className="ui-badge">{suggestions.length}</span>
              ) : null}
            </div>

            {suggestions.length > 0 ? (
              <div className="space-y-2">
                {suggestions.map((entry) => (
                  <div
                    className="flex items-start gap-3 rounded-[14px] border border-black/10 bg-white px-3 py-3"
                    key={entry.type_name}
                  >
                    <NodeGlyph
                      category={entry.category}
                      className="shrink-0"
                      kind="step"
                      source={entry.source}
                      typeName={entry.type_name}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium text-ink">{entry.label}</div>
                        {entry.app_record ? (
                          <span className="rounded-md bg-[#f3f0ff] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#6f63ff]">
                            {entry.app_record.source_kind === "generated"
                              ? "Generated"
                              : entry.app_record.source_kind === "custom"
                                ? "Custom"
                                : "Saved"}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-[12px] leading-5 text-slate">
                        {entry.description}
                      </div>
                    </div>
                    <button
                      aria-label={`Add ${entry.type_name}`}
                      className="ui-button !px-2.5 !py-1.5"
                      onClick={() => onSelectType(entry.type_name)}
                      type="button"
                    >
                      Add
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[14px] border border-black/10 bg-white px-4 py-4 text-sm leading-6 text-slate">
                Enter a workflow brief to get likely step suggestions from the capabilities you already have.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function scoreStepSuggestion(entry: StepTypeEntry, tokens: string[]) {
  if (tokens.length === 0) {
    return 0;
  }

  const haystack = [entry.label, entry.description, entry.type_name, entry.category, entry.source]
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0)
    .join(" ")
    .toLowerCase();

  return tokens.reduce((score, token) => {
    if (haystack.includes(token)) {
      return score + 2;
    }
    if (token.length > 3 && haystack.includes(token.slice(0, -1))) {
      return score + 1;
    }
    return score;
  }, 0);
}

function AssistantIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 16 16">
      <path
        d="M8 2.5a2.2 2.2 0 0 1 2.2 2.2v.55a2.75 2.75 0 0 1 1.55 2.48v1.7c0 .9-.73 1.62-1.62 1.62H5.87c-.9 0-1.62-.73-1.62-1.62v-1.7A2.75 2.75 0 0 1 5.8 5.25V4.7A2.2 2.2 0 0 1 8 2.5Zm-1.35 9.45h2.7M6.3 7.6h.01m3.38 0h.01"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 16 16">
      <path
        d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.25"
      />
    </svg>
  );
}
