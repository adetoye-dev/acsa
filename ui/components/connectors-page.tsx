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

import { useEffect, useMemo, useState } from "react";

import { ConnectorManager } from "./connector-manager";
import { DeveloperToolsSection } from "./connectors/developer-tools-section";
import { InstalledPacksPanel } from "./connectors/installed-packs-panel";
import { StarterPacksPanel } from "./connectors/starter-packs-panel";
import type { ConnectorInventoryResponse } from "../lib/connectors";
import {
  buildInstalledStarterConnectorPackRows,
  buildStarterConnectorPackRows
} from "../lib/connectors-home";
import { fetchEngineJson } from "../lib/engine-client";
import {
  fetchStarterConnectorPacks,
  installStarterConnectorPack,
  type StarterConnectorPack
} from "../lib/starter-connector-packs";

export function ConnectorsPage() {
  const [error, setError] = useState<string | null>(null);
  const [installingPackId, setInstallingPackId] = useState<string | null>(null);
  const [inventory, setInventory] = useState<ConnectorInventoryResponse | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [starterPacks, setStarterPacks] = useState<StarterConnectorPack[]>([]);

  useEffect(function loadConnectorLibraryOnMountEffect() {
    void refreshConnectorLibrary();
  }, []);

  const starterRows = useMemo(
    () => buildStarterConnectorPackRows(starterPacks),
    [starterPacks]
  );
  const installedRows = useMemo(
    () => buildInstalledStarterConnectorPackRows(starterPacks, inventory),
    [inventory, starterPacks]
  );

  async function fetchConnectorLibraryOrThrow() {
    const [starterPackResponse, connectorResponse] = await Promise.all([
      fetchStarterConnectorPacks(),
      fetchEngineJson<ConnectorInventoryResponse>("/api/connectors")
    ]);
    return { connectorResponse, starterPackResponse };
  }

  async function refreshConnectorLibrary() {
    setIsRefreshing(true);
    try {
      const { connectorResponse, starterPackResponse } = await fetchConnectorLibraryOrThrow();
      setStarterPacks(starterPackResponse);
      setInventory(connectorResponse);
      setError(null);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Failed to load connectors"
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleInstallPack(packId: string) {
    setInstallingPackId(packId);
    let didInstall = false;

    try {
      await installStarterConnectorPack(packId);
      didInstall = true;

      const { connectorResponse, starterPackResponse } = await fetchConnectorLibraryOrThrow();
      setStarterPacks(starterPackResponse);
      setInventory(connectorResponse);
      setError(null);
    } catch (nextError) {
      if (didInstall) {
        setError(
          nextError instanceof Error
            ? `Installed capability pack but failed to refresh library: ${nextError.message}`
            : "Installed capability pack but failed to refresh connector library"
        );
        return;
      }

      setError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to install capability pack"
      );
    } finally {
      setInstallingPackId(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[60px] items-center justify-between gap-4 border-b border-black/10 bg-white px-5">
        <div>
          <h1 className="section-title mt-2">Connectors</h1>
          <p className="mt-0.5 text-sm text-[#68707a]">Install ready-made packs like Email, Slack, GitHub, or Sheets, then use their steps in workflows.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="ui-badge">{starterRows.length} capability packs</span>
          <span className="ui-badge">{installedRows.length} installed</span>
          <button
            aria-busy={isRefreshing}
            className="ui-button"
            disabled={isRefreshing}
            onClick={() => void refreshConnectorLibrary()}
            type="button"
          >
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      <div className="sleek-scroll min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div aria-live="assertive" className="border-b border-rose-400/18 bg-rose-50 px-5 py-3 text-sm leading-6 text-[#c65a72]" role="alert">
            {error}
          </div>
        ) : null}

        <div className="grid xl:grid-cols-[minmax(0,1fr)_380px]">
          <StarterPacksPanel
            activePackId={installingPackId}
            isLoading={isRefreshing}
            onInstallPack={(packId) => void handleInstallPack(packId)}
            rows={starterRows}
          />
          <InstalledPacksPanel
            isLoading={isRefreshing}
            rows={installedRows}
          />
        </div>

        <div className="border-t border-black/10">
          <DeveloperToolsSection>
            <ConnectorManager
              onCatalogInvalidated={() => void refreshConnectorLibrary()}
            />
          </DeveloperToolsSection>
        </div>
      </div>
    </div>
  );
}
