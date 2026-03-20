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

import type { InstalledStarterConnectorPackRow } from "../../lib/connectors-home";
import { ConnectorPackRow } from "./connector-pack-row";

type InstalledPacksPanelProps = {
  isLoading: boolean;
  rows: InstalledStarterConnectorPackRow[];
};

export function InstalledPacksPanel({
  isLoading,
  rows
}: InstalledPacksPanelProps) {
  return (
    <section className="overflow-hidden bg-white">
      <div className="border-b border-black/10 px-4 py-4">
        <p className="section-kicker">Installed capability packs</p>
        <h2 className="section-title mt-2">See what your workspace is ready to do</h2>
      </div>

      <div className="space-y-3 px-4 py-4">
        {isLoading && rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm leading-6 text-[#6b7380]">
            Loading installed capability packs…
          </div>
        ) : null}

        {!isLoading && rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm leading-6 text-[#6b7380]">
            No capability packs are installed yet.
          </div>
        ) : null}

        {rows.map((row) => (
          <ConnectorPackRow
            key={row.id}
            description={row.description}
            metadata={row.metadata}
            statusLabel={row.statusLabel}
            title={row.name}
          />
        ))}
      </div>
    </section>
  );
}
