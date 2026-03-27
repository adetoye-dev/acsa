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

import Link from "next/link";

import { semanticStepTypeSummary } from "../../lib/semantic-labels";
import type { StarterReadinessItem } from "../../lib/workflows-home";
import type { LaunchpadEmptyState } from "./recent-workflows-panel";

type StarterTemplatesRailProps = {
  emptyState: LaunchpadEmptyState;
  items: StarterReadinessItem[];
  primary: boolean;
};

export function StarterTemplatesRail({
  emptyState,
  items,
  primary: _primary
}: StarterTemplatesRailProps) {
  return (
    <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-white">
      <div className="border-b border-black/10 px-5 py-4">
        <h2 className="text-[15px] font-medium tracking-tight text-ink">
          Outcome-ready starters
        </h2>
        {emptyState === "empty" ? (
          <div className="mt-3 text-sm leading-6 text-[#5c4aa5]">
            No workflows exist yet. Start from a real automation outcome instead of a blank canvas.
          </div>
        ) : null}
      </div>

      <div className="sleek-scroll min-h-0 overflow-y-auto px-4 py-4">
        <div className="space-y-3">
          {items.map((item) => (
            <StarterCard key={item.starter.id} item={item} />
          ))}
        </div>
      </div>
    </aside>
  );
}

function StarterCard({ item }: { item: StarterReadinessItem }) {
  const href = `/workflows/new?starter=${encodeURIComponent(item.starter.id)}`;
  const stateLabel = starterReadinessLabel(item.state);
  const stateTone = starterReadinessTone(item.state);
  const requirementsLabel =
    item.requiredStepTypes.length > 0
      ? `${item.requiredStepTypes.length} required connector capability${
          item.requiredStepTypes.length === 1 ? "" : "s"
        }`
      : "Uses built-in capabilities only";
  const missingCapabilities = semanticStepTypeSummary(item.missingStepTypes);

  return (
    <Link
      className="block rounded-[16px] border border-black/10 bg-white px-4 py-4 transition hover:-translate-y-0.5 hover:border-black/15 hover:bg-white/95"
      href={href}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium tracking-tight text-ink">
            {item.starter.name}
          </div>
          <div className="mt-1 text-sm leading-6 text-slate">{item.starter.description}</div>
        </div>
        <span className={`rounded-[8px] px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] ${stateTone}`}>
          {stateLabel}
        </span>
      </div>

      <div className="mt-3 text-[11px] uppercase tracking-[0.14em] text-slate/55">
        {requirementsLabel}
      </div>

      {item.missingStepTypes.length > 0 ? (
        <div className="mt-2 text-sm leading-6 text-[#a76825]">
          Missing {missingCapabilities}
        </div>
      ) : (
        <div className="mt-2 text-sm leading-6 text-[#2e7b54]">Creates a workflow in your workspace.</div>
      )}
    </Link>
  );
}

function starterReadinessLabel(state: StarterReadinessItem["state"]): string {
  switch (state) {
    case "loading":
      return "Loading";
    case "blocked_by_connector":
      return "Missing connector";
    case "blocked_by_setup":
      return "Setup required";
    case "ready":
      return "Ready";
  }
}

function starterReadinessTone(state: StarterReadinessItem["state"]): string {
  switch (state) {
    case "loading":
      return "bg-black/5 text-slate";
    case "blocked_by_connector":
      return "bg-amber-50 text-[#a76825]";
    case "blocked_by_setup":
      return "bg-[#f2ebff] text-[#6b34d7]";
    case "ready":
      return "bg-emerald-50 text-[#2e7b54]";
  }
}
