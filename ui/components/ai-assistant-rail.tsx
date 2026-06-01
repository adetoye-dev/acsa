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
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X } from "lucide-react";

import type { StepTypeEntry } from "../lib/workflow-editor";
import { NodeGlyph } from "./node-visuals";

const EXAMPLE_PROMPTS = [
  "When I receive a webhook, validate the payload and send Slack updates.",
  "Every day at 9am, fetch data from an API and email me the summary.",
  "Pause the workflow for approval before sending the final message."
] as const;

type AiAssistantRailProps = {
  onClose?: () => void;
  onSelectType: (typeName: string) => void;
  stepCatalog: StepTypeEntry[];
};

export function AiAssistantRail({
  onClose,
  onSelectType,
  stepCatalog
}: AiAssistantRailProps) {
  const [prompt, setPrompt] = useState("");

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

  return (
    <motion.section 
      initial={{ x: 300, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 300, opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] border-l border-black/5 bg-white/80 backdrop-blur-xl shadow-[-4px_0_24px_rgba(0,0,0,0.02)]"
    >
      <div className="border-b border-black/5 px-4 py-4 bg-white/40">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-gradient-to-br from-[#f3f0ff] to-[#e6dfff] text-[#6f63ff] shadow-sm">
              <Sparkles size={18} strokeWidth={2} />
            </span>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#6f63ff]/80">
                AI Assistant
              </div>
              <div className="mt-0.5 text-[15px] font-semibold tracking-tight text-ink">
                Describe the workflow
              </div>
            </div>
          </div>
          {onClose ? (
            <button
              aria-label="Close assistant"
              className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-black/5 bg-white/50 text-slate/70 transition-all duration-200 hover:scale-105 hover:border-black/10 hover:bg-white hover:text-ink hover:shadow-sm"
              onClick={onClose}
              type="button"
            >
              <X size={16} strokeWidth={2} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="sleek-scroll min-h-0 overflow-y-auto px-4 py-5">
        <div className="space-y-5">
          <div className="rounded-[16px] border border-[#6f63ff]/10 bg-gradient-to-b from-white to-[#faf9ff] px-4 py-4 shadow-sm">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/70" htmlFor="workflow-assistant-prompt">
              Workflow brief
            </label>
            <textarea
              className="ui-input min-h-[118px] resize-none leading-6 w-full rounded-[12px] border-black/5 bg-white/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] focus-visible:ring-[#6f63ff]/30 focus-visible:border-[#6f63ff]/40 transition-all"
              id="workflow-assistant-prompt"
              onChange={(event) => {
                setPrompt(event.target.value);
              }}
              placeholder="Describe what should happen and the assistant will suggest likely steps from your installed library."
              value={prompt}
            />
          </div>

          <div>
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/60">
              Try these prompts
            </div>
            <div className="space-y-2">
              {EXAMPLE_PROMPTS.map((example) => (
                <button
                  className="w-full rounded-[14px] border border-black/5 bg-white/60 px-3.5 py-3 text-left text-[13px] leading-6 text-slate transition-all duration-200 hover:-translate-y-0.5 hover:border-[#6f63ff]/20 hover:bg-white hover:shadow-sm"
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
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/60">
                Suggested steps
              </div>
              <AnimatePresence>
                {suggestions.length > 0 ? (
                  <motion.span 
                    initial={{ scale: 0 }} 
                    animate={{ scale: 1 }} 
                    exit={{ scale: 0 }} 
                    className="flex h-5 w-5 items-center justify-center rounded-full bg-[#f3f0ff] text-[10px] font-bold text-[#6f63ff]"
                  >
                    {suggestions.length}
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </div>

            {suggestions.length > 0 ? (
              <div className="space-y-2">
                {suggestions.map((entry, index) => (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="group"
                    key={entry.type_name}
                  >
                    <div className="flex items-center gap-3 rounded-[14px] border border-black/5 bg-white/70 px-3 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.01)] transition-all duration-200 hover:border-[#6f63ff]/20 hover:bg-white hover:shadow-md">
                      <NodeGlyph
                        category={entry.category}
                        className="shrink-0 group-hover:scale-105 transition-transform"
                        kind="step"
                        size="md"
                        typeName={entry.type_name}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-[13px] font-semibold text-ink">{entry.label}</div>
                        </div>
                        <div className="mt-0.5 truncate text-[11px] leading-5 text-slate/80">
                          {entry.description}
                        </div>
                      </div>
                      <button
                        aria-label={`Add ${entry.type_name}`}
                        className="flex h-7 items-center justify-center rounded-lg bg-black/5 px-3 text-[11px] font-semibold tracking-wide text-ink transition-all hover:bg-[#6f63ff] hover:text-white"
                        onClick={() => onSelectType(entry.type_name)}
                        type="button"
                      >
                        Add
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="rounded-[14px] border border-black/5 bg-white/40 px-4 py-5 text-center text-[13px] leading-6 text-slate/80">
                Enter a workflow brief to get likely step suggestions from the capabilities you already have.
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  );
}

function scoreStepSuggestion(entry: StepTypeEntry, tokens: string[]) {
  if (tokens.length === 0) {
    return 0;
  }

  const haystack = [entry.label, entry.description, entry.type_name, entry.category]
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
