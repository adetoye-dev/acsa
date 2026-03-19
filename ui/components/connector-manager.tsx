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
  type ConnectorRuntime,
  type ConnectorScaffoldResponse,
  type ConnectorTestResponse
} from "../lib/connectors";
import { fetchEngineJson } from "../lib/engine-client";
import {
  connectorRuntimeLabel,
  connectorRuntimeTone,
  connectorTrustLabel,
  connectorValidityLabel
} from "../lib/product-status";
import { slugifyIdentifier } from "../lib/workflow-editor";

type ConnectorManagerProps = {
  onCatalogInvalidated: () => Promise<void> | void;
};

export function ConnectorManager({ onCatalogInvalidated }: ConnectorManagerProps) {
  const [inventory, setInventory] = useState<ConnectorInventoryResponse | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [isScaffolding, setIsScaffolding] = useState(false);
  const [isTypeDirty, setIsTypeDirty] = useState(false);
  const [lastAction, setLastAction] = useState("Loading connector inventory");
  const [nameDraft, setNameDraft] = useState("");
  const [runtimeDraft, setRuntimeDraft] = useState<ConnectorRuntime>("process");
  const [testResults, setTestResults] = useState<Record<string, ConnectorTestResponse>>({});
  const [testingType, setTestingType] = useState<string | null>(null);
  const [typeDraft, setTypeDraft] = useState("");

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

  async function handleScaffold() {
    const nextName = nameDraft.trim();
    const nextType = slugifyIdentifier((isTypeDirty ? typeDraft : nextName).trim());
    if (!nextName || !nextType) {
      setGlobalError("Connector name and type id are required.");
      return;
    }

    setIsScaffolding(true);
    try {
      const response = await fetchEngineJson<ConnectorScaffoldResponse>("/api/connectors/scaffold", {
        body: JSON.stringify({
          name: nextName,
          runtime: runtimeDraft,
          type_id: nextType
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
      setNameDraft("");
      setTypeDraft("");
      setIsTypeDirty(false);
      setGlobalError(null);
      setLastAction(`Scaffolded ${response.connector.name}`);
      await refreshInventory();
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "Connector scaffold failed");
      setLastAction("Connector scaffold failed");
    } finally {
      setIsScaffolding(false);
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
    <section className="panel-surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-black/10 px-5 py-4">
        <div>
          <p className="section-kicker">Connectors</p>
          <h2 className="section-title mt-2">Local plugin manager</h2>
        </div>
        <button
          className="ui-button"
          onClick={() => void refreshInventory()}
          type="button"
        >
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="space-y-5 px-5 py-5">
        <div className="rounded-2xl border border-black/10 bg-white/65 p-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/70">
            <span className="ui-badge">{sortedConnectors.length} loaded</span>
            <span className="ui-badge">{inventory?.invalid_connectors.length ?? 0} invalid</span>
            <span className={`rounded-md px-2 py-1 font-mono ${inventory?.wasm_enabled ? "bg-tide/10 text-tide" : "bg-ember/10 text-ember"}`}>
              WASM {inventory?.wasm_enabled ? "enabled" : "disabled"}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate">
            Connectors are loaded from
            <code className="mx-1 rounded bg-sand px-1.5 py-0.5 font-mono text-ember">
              {inventory?.connectors_dir ?? "connectors/"}
            </code>
            and stay Git-visible in the repo.
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

        <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="section-kicker">Scaffold</p>
              <h3 className="section-title mt-2">Start a new connector</h3>
            </div>
            <span className="ui-badge font-mono">{runtimeDraft}</span>
          </div>

          <div className="mt-4 grid gap-3">
            <label className="grid gap-2 text-sm text-slate" htmlFor="connector-name">
              Name
              <input
                className="ui-input"
                id="connector-name"
                onChange={(event) => {
                  const nextName = event.target.value;
                  setNameDraft(nextName);
                  if (!isTypeDirty) {
                    setTypeDraft(slugifyIdentifier(nextName));
                  }
                }}
                placeholder="sample-echo"
                type="text"
                value={nameDraft}
              />
            </label>

            <label className="grid gap-2 text-sm text-slate" htmlFor="connector-type">
              Type id
              <input
                className="ui-input font-mono"
                id="connector-type"
                onChange={(event) => {
                  setIsTypeDirty(true);
                  setTypeDraft(slugifyIdentifier(event.target.value));
                }}
                placeholder="sample_echo"
                type="text"
                value={typeDraft}
              />
            </label>

            <label className="grid gap-2 text-sm text-slate" htmlFor="connector-runtime">
              Runtime
              <select
                className="ui-input"
                id="connector-runtime"
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "process" || value === "wasm") {
                    setRuntimeDraft(value);
                  }
                }}
                value={runtimeDraft}
              >
                <option value="process">Process</option>
                <option value="wasm">WASM</option>
              </select>
            </label>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-sm leading-6 text-slate">
              Acsa writes the manifest, sample input, README, and runtime starter files for you.
            </p>
            <button
              className="ui-button ui-button-tide"
              disabled={isScaffolding}
              onClick={() => void handleScaffold()}
              type="button"
            >
              {isScaffolding ? "Scaffolding..." : "Scaffold"}
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {sortedConnectors.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-black/15 bg-white/60 px-4 py-8 text-center text-sm leading-6 text-slate">
              No connectors are loaded yet. Scaffold one here or add a manifest under the local connectors directory.
            </div>
          ) : (
            sortedConnectors.map((connector) => {
              const testResult = testResults[connector.type_name];

              return (
                <article
                  key={connector.type_name}
                  className="rounded-2xl border border-black/10 bg-white/75 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-xl text-ink">{connector.name}</h3>
                        <span
                          className={`rounded-md px-2 py-1 font-mono text-[11px] uppercase tracking-[0.16em] ${connectorRuntimeTone(connector.connector_state)}`}
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
                      </div>
                      <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-slate/65">
                        {connector.type_name}
                      </p>
                    </div>
                    <button
                      className="ui-button"
                      disabled={testingType === connector.type_name || !connector.sample_input_path}
                      onClick={() => void handleRunSample(connector)}
                      type="button"
                    >
                      {testingType === connector.type_name ? "Testing..." : "Run sample"}
                    </button>
                  </div>

                  <div className="mt-3 grid gap-2 text-sm leading-6 text-slate">
                    <p>Entry: <code className="rounded bg-sand px-1.5 py-0.5 font-mono text-ink">{connector.entry}</code></p>
                    <p>Inputs: <span className="font-mono text-ink">{connector.inputs.join(", ") || "none"}</span></p>
                    <p>Outputs: <span className="font-mono text-ink">{connector.outputs.join(", ") || "none"}</span></p>
                    <p>
                      Steps:{" "}
                      <span className="font-mono text-ink">
                        {connector.provided_step_types.join(", ") || connector.type_name}
                      </span>
                    </p>
                    <p>
                      Used by:{" "}
                      <span className="font-mono text-ink">
                        {connector.used_by_workflows.join(", ") || "No workflows yet"}
                      </span>
                    </p>
                    <p>Manifest: <code className="rounded bg-sand px-1.5 py-0.5 font-mono text-[11px] text-ink">{connector.manifest_path}</code></p>
                  </div>

                  {connector.notes.length > 0 ? (
                    <div className="mt-3 rounded-xl border border-ember/15 bg-ember/5 px-3 py-3 text-sm leading-6 text-ember">
                      {connector.notes.map((note, index) => (
                        <p key={`${note}-${index}`}>{note}</p>
                      ))}
                    </div>
                  ) : null}

                  {(connector.allowed_env.length > 0 || connector.allowed_hosts.length > 0) ? (
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/70">
                      {connector.allowed_env.length > 0 ? (
                        <span className="ui-badge font-mono">
                          env: {connector.allowed_env.join(", ")}
                        </span>
                      ) : null}
                      {connector.allowed_hosts.length > 0 ? (
                        <span className="ui-badge font-mono">
                          hosts: {connector.allowed_hosts.join(", ")}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {testResult ? (
                    <div className="mt-4 rounded-xl border border-tide/20 bg-tide/5 p-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-tide">
                        Latest sample result
                      </div>
                      <pre className="mt-3 overflow-x-auto rounded-xl bg-ink px-3 py-3 font-mono text-[11px] leading-6 text-white">
{JSON.stringify(testResult.output, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </div>

        {(inventory?.invalid_connectors.length ?? 0) > 0 ? (
          <div className="rounded-2xl border border-ember/20 bg-ember/5 p-4">
            <p className="section-kicker text-ember">Needs attention</p>
            <div className="mt-3 space-y-3">
              {inventory?.invalid_connectors.map((connector) => (
                <article
                  key={connector.id}
                  className="rounded-xl border border-ember/15 bg-white/80 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-ink">{connector.id}</div>
                    <span className="ui-badge font-mono">
                      {connectorValidityLabel(connector.connector_state.install_validity.state)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate">{connector.error}</p>
                  {connector.provided_step_types.length > 0 ? (
                    <p className="mt-2 text-sm leading-6 text-slate">
                      Steps:{" "}
                      <span className="font-mono text-ink">
                        {connector.provided_step_types.join(", ")}
                      </span>
                    </p>
                  ) : null}
                  {connector.used_by_workflows.length > 0 ? (
                    <p className="mt-1 text-sm leading-6 text-slate">
                      Used by:{" "}
                      <span className="font-mono text-ink">
                        {connector.used_by_workflows.join(", ")}
                      </span>
                    </p>
                  ) : null}
                  {connector.manifest_path ? (
                    <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-slate/65">
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
