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

import type { StarterConnectorPackRow } from "../../lib/connectors-home";
import { ConnectorPackRow } from "./connector-pack-row";

type StarterPacksPanelProps = {
  activePackId?: string | null;
  isLoading: boolean;
  onInstallPack: (packId: string) => void;
  rows: StarterConnectorPackRow[];
};

export function StarterPacksPanel({
  activePackId = null,
  isLoading,
  onInstallPack,
  rows
}: StarterPacksPanelProps) {
  return (
    <section className="panel-surface overflow-hidden">
      <div className="border-b border-black/10 px-4 py-4">
        <p className="section-kicker">Starter packs</p>
        <h2 className="section-title mt-2">Install a curated first-party connector</h2>
      </div>

      <div className="space-y-3 px-4 py-4">
        {isLoading && rows.length === 0 ? (
          <div className="rounded-[12px] border border-dashed border-black/15 bg-white/80 px-4 py-8 text-center text-sm leading-6 text-[#6b7380]">
            Loading starter packs…
          </div>
        ) : null}

        {!isLoading && rows.length === 0 ? (
          <div className="rounded-[12px] border border-dashed border-black/15 bg-white/80 px-4 py-8 text-center text-sm leading-6 text-[#6b7380]">
            No curated starter packs are available right now.
          </div>
        ) : null}

        {rows.map((row) => (
          <ConnectorPackRow
            key={row.id}
            actionDisabled={row.ctaLabel !== "Install" || activePackId === row.id}
            actionLabel={activePackId === row.id ? "Installing…" : row.ctaLabel}
            actionTone={row.ctaLabel === "Install" ? "primary" : "default"}
            description={row.description}
            helperText={row.helperText}
            metadata={row.installed ? ["Installed locally"] : ["Copies into connectors/"]}
            onAction={
              row.ctaLabel === "Install" ? () => onInstallPack(row.id) : undefined
            }
            title={row.name}
          />
        ))}
      </div>
    </section>
  );
}
