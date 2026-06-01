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

import { useEffect, useMemo, useState } from "react";

import {
  type ConnectorInventoryItem,
  type ConnectorInventoryResponse,
  type ConnectorTestResponse
} from "../lib/connectors";
import { fetchEngineJson } from "../lib/engine-client";
import {
  connectorRuntimeLabel,
  connectorRuntimeTone,
  connectorSetupLabel,
  connectorSetupTone,
  connectorTrustLabel,
  connectorValidityLabel
} from "../lib/product-status";

type ConnectorManagerProps = {
  onCatalogInvalidated: () => Promise<void> | void;
};

export function ConnectorManager({ onCatalogInvalidated }: ConnectorManagerProps) {
  const [inventory, setInventory] = useState<ConnectorInventoryResponse | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [lastAction, setLastAction] = useState("Loading connector inventory");
  const [testResults, setTestResults] = useState<Record<string, ConnectorTestResponse>>({});
  const [testingType, setTestingType] = useState<string | null>(null);

  const sortedConnectors = useMemo(
    () => [...(inventory?.connectors ?? [])].sort((left, right) => left.name.localeCompare(right.name)),
    [inventory?.connectors]
  );

  useEffect(function loadConnectorInventoryOnMountEffect() {
    void refreshInventory();
  }, []);

  async function refreshInventory() {
    setIsRefreshing(true);
    try {
      const response = await fetchEngineJson<ConnectorInventoryResponse>("/api/connectors");
      setInventory(response);
      setLastAction("Loaded connector inventory");
      setGlobalError(null);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "Failed to load connectors");
      setLastAction("Failed to load connector inventory");
      setIsRefreshing(false);
      return;
    }

    try {
      await onCatalogInvalidated();
    } catch (error) {
      setGlobalError(
        error instanceof Error
          ? `Loaded connector inventory, but failed to refresh catalog: ${error.message}`
          : "Loaded connector inventory, but failed to refresh catalog"
      );
      setLastAction("Connector inventory loaded with catalog refresh warning");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleRunSample(connector: ConnectorInventoryItem) {
    setTestingType(connector.type_name);
    try {
      const response = await fetchEngineJson<ConnectorTestResponse>(
        `/api/connectors/${connector.type_name}/test`,
        {
          body: JSON.stringify({}),
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        }
      );
      setTestResults((current) => ({
        ...current,
        [connector.type_name]: response
      }));
      setGlobalError(null);
      setLastAction(`Ran sample for ${connector.name}`);
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : `Failed to test ${connector.name}`);
      setLastAction(`Connector test failed for ${connector.name}`);
    } finally {
      setTestingType(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="section-kicker">Integrations catalog</p>
          <h2 className="section-title mt-2">Pre-installed static connectors</h2>
        </div>
        <button
          className="ui-button transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
          onClick={() => void refreshInventory()}
          type="button"
        >
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="space-y-4">
        {/* Status bar */}
        <div className="rounded-[12px] border border-black/10 bg-white/80 p-4 shadow-sm backdrop-blur-md transition-all duration-300 hover:shadow-md">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/70">
            <span className="ui-badge bg-tide/10 text-tide">{sortedConnectors.length} active</span>
            <span className="ui-badge bg-ember/10 text-ember">{inventory?.invalid_connectors.length ?? 0} invalid</span>
            <span className={`rounded-md px-2 py-1 font-mono ${inventory?.wasm_enabled ? "bg-emerald-500/10 text-emerald-600" : "bg-ember/10 text-ember"}`}>
              WASM {inventory?.wasm_enabled ? "enabled" : "disabled"}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate">
            All connectors are statically discovered directly from the workspace and are immediately available to execute.
          </p>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-slate/65">
            {lastAction}
          </p>
          {globalError ? (
            <p className="mt-3 rounded-xl border border-ember/20 bg-ember/5 px-3 py-2 text-sm leading-6 text-ember">
              {globalError}
            </p>
          ) : null}
        </div>

        {/* Clean single-column integrations feed */}
        <div className="space-y-4">
          {sortedConnectors.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-black/15 bg-white/80 px-4 py-12 text-center text-sm leading-6 text-slate">
              No connectors are discovered in the connectors directory.
            </div>
          ) : (
            sortedConnectors.map((connector) => {
              const testResult = testResults[connector.type_name];

              return (
                <article
                  key={connector.type_name}
                  className="rounded-[12px] border border-black/10 bg-white/85 p-5 shadow-sm transition-all duration-300 hover:shadow-md hover:border-black/15"
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-[#101a1d]">{connector.name}</h3>
                        <span
                          className={`rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${connectorRuntimeTone(connector.connector_state)}`}
                        >
                          {connectorRuntimeLabel(connector.connector_state.runtime.mode)}
                        </span>
                        {connector.version ? (
                          <span className="ui-badge font-mono">{connector.version}</span>
                        ) : null}
                        <span className="ui-badge">
                          {connectorTrustLabel(connector.connector_state.trust)}
                        </span>
                        <span className="ui-badge">
                          {connectorValidityLabel(
                            connector.connector_state.install_validity.state
                          )}
                        </span>
                        <span
                          className={`rounded-md px-2 py-1 text-[10px] font-semibold tracking-wider uppercase ${connectorSetupTone(connector.connector_state)}`}
                        >
                          {connectorSetupLabel(connector.connector_state)}
                        </span>
                      </div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate/50">
                        {connector.type_name}
                      </p>
                      <p className="max-w-[75ch] text-sm leading-6 text-slate">
                        {connector.description}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end md:self-start">
                      <button
                        className="ui-button ui-button-tide transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                        disabled={testingType === connector.type_name || !connector.sample_input_path}
                        onClick={() => void handleRunSample(connector)}
                        type="button"
                      >
                        {testingType === connector.type_name ? "Testing..." : "Run sample"}
                      </button>
                    </div>
                  </div>

                  {/* Core properties grid */}
                  <div className="mt-4 pt-4 border-t border-black/5 grid gap-x-6 gap-y-2 text-xs text-slate/85 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                    <p><span className="font-semibold text-slate/60 mr-1">Entry:</span> <code className="rounded bg-sand/60 px-1.5 py-0.5 font-mono text-[11px] text-ink">{connector.entry}</code></p>
                    <p><span className="font-semibold text-slate/60 mr-1">Inputs:</span> <span className="font-mono text-ink font-medium">{connector.inputs.join(", ") || "none"}</span></p>
                    <p><span className="font-semibold text-slate/60 mr-1">Outputs:</span> <span className="font-mono text-ink font-medium">{connector.outputs.join(", ") || "none"}</span></p>
                    <p>
                      <span className="font-semibold text-slate/60 mr-1">Steps:</span>{" "}
                      <span className="font-mono text-ink font-medium">
                        {connector.provided_step_types.join(", ") || connector.type_name}
                      </span>
                    </p>
                    <p>
                      <span className="font-semibold text-slate/60 mr-1">Used by:</span>{" "}
                      <span className="font-mono text-ink font-medium">
                        {connector.used_by_workflows.join(", ") || "No active workflows"}
                      </span>
                    </p>
                    <p className="truncate"><span className="font-semibold text-slate/60 mr-1">Manifest:</span> <code className="rounded bg-sand/60 px-1.5 py-0.5 font-mono text-[10px] text-ink">{connector.manifest_path}</code></p>
                  </div>

                  {connector.notes.length > 0 ? (
                    <div className="mt-4 rounded-xl border border-ember/15 bg-ember/5 px-3 py-2.5 text-xs text-ember space-y-1">
                      {connector.notes.map((note, index) => (
                        <p key={index} className="flex items-center gap-1.5">
                          <span className="inline-block w-1 h-1 rounded-full bg-ember shrink-0" />
                          {note}
                        </p>
                      ))}
                    </div>
                  ) : null}

                  {(connector.allowed_env.length > 0 || connector.allowed_hosts.length > 0) ? (
                    <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate/60">
                      {connector.allowed_env.length > 0 ? (
                        <span className="ui-badge font-mono bg-tide/5 text-tide">
                          env: {connector.allowed_env.join(", ")}
                        </span>
                      ) : null}
                      {connector.allowed_hosts.length > 0 ? (
                        <span className="ui-badge font-mono bg-tide/5 text-tide">
                          hosts: {connector.allowed_hosts.join(", ")}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {testResult ? (
                    <div className="mt-4 rounded-xl border border-tide/20 bg-tide/5 p-4 transition-all duration-300">
                      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-tide">
                        Latest sample result
                      </div>
                      <pre className="mt-3 overflow-x-auto rounded-xl bg-ink px-4 py-3 font-mono text-[11px] leading-6 text-white/95 shadow-inner">
{JSON.stringify(testResult.output, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </div>

        {/* Invalid connectors block */}
        {(inventory?.invalid_connectors.length ?? 0) > 0 ? (
          <div className="rounded-[12px] border border-ember/20 bg-ember/5 p-5 shadow-sm">
            <p className="section-kicker text-ember">Needs attention</p>
            <h3 className="text-sm font-semibold text-ink mt-1">Invalid Connectors discovered</h3>
            <div className="mt-4 space-y-3">
              {inventory?.invalid_connectors.map((connector) => (
                <article
                  key={connector.id}
                  className="rounded-[10px] border border-ember/15 bg-white/80 p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-ink text-sm">{connector.id}</div>
                    <span className="ui-badge font-mono bg-ember/10 text-ember">
                      {connectorValidityLabel(connector.connector_state.install_validity.state)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate">{connector.error}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                    <span
                      className={`inline-flex rounded px-2 py-0.5 font-medium ${connectorSetupTone(connector.connector_state)}`}
                    >
                      {connectorSetupLabel(connector.connector_state)}
                    </span>
                    {connector.provided_step_types.length > 0 ? (
                      <p className="text-slate">
                        Steps: <span className="font-mono text-ink font-medium">{connector.provided_step_types.join(", ")}</span>
                      </p>
                    ) : null}
                    {connector.used_by_workflows.length > 0 ? (
                      <p className="text-slate">
                        Used by: <span className="font-mono text-ink font-medium">{connector.used_by_workflows.join(", ")}</span>
                      </p>
                    ) : null}
                  </div>
                  {connector.manifest_path ? (
                    <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.16em] text-slate/50">
                      {connector.manifest_path}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
