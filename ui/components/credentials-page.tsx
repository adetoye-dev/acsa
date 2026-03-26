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

import type { ConnectorInventoryResponse } from "../lib/connectors";
import { fetchCredentials, removeCredential, saveCredential, type CredentialItem } from "../lib/credentials";
import { fetchEngineJson } from "../lib/engine-client";

const STARTER_REFERENCE_GROUPS = [
  {
    label: "AI workflows",
    names: ["OPENAI_API_KEY"]
  },
  {
    label: "Webhook intake",
    names: ["ACSA_WEBHOOK_SECRET"]
  }
] as const;

const REFERENCE_COPY: Record<string, { label: string; description: string }> = {
  OPENAI_API_KEY: {
    label: "OpenAI models",
    description: "Used by AI writing, summarization, and agent steps."
  },
  ACSA_WEBHOOK_SECRET: {
    label: "Webhook verification",
    description: "Used to verify signed or token-protected inbound webhooks."
  },
  ACSA_SMTP_FROM: {
    label: "Email delivery",
    description: "Used by the Email connector pack."
  },
  ACSA_SMTP_HOST: {
    label: "Email delivery",
    description: "Used by the Email connector pack."
  },
  ACSA_SMTP_PASSWORD: {
    label: "Email delivery",
    description: "Used by the Email connector pack."
  },
  ACSA_SMTP_PORT: {
    label: "Email delivery",
    description: "Used by the Email connector pack."
  },
  ACSA_SMTP_TLS: {
    label: "Email delivery",
    description: "Used by the Email connector pack."
  },
  ACSA_SMTP_USERNAME: {
    label: "Email delivery",
    description: "Used by the Email connector pack."
  }
};

export function CredentialsPage() {
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [connectorInventory, setConnectorInventory] = useState<ConnectorInventoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [removingName, setRemovingName] = useState<string | null>(null);

  useEffect(function loadCredentialsPageOnMountEffect() {
    void refresh();
  }, []);

  const connectorReferences = useMemo(() => {
    if (!connectorInventory) {
      return [];
    }

    return Array.from(
      new Set(
        connectorInventory.connectors.flatMap((connector) => connector.allowed_env)
      )
    ).sort((left, right) => left.localeCompare(right));
  }, [connectorInventory]);

  const starterReferences = useMemo(
    () => Array.from(new Set(STARTER_REFERENCE_GROUPS.flatMap((group) => group.names))),
    []
  );
  const starterReferenceSet = useMemo<Set<string>>(
    () => new Set<string>(starterReferences),
    [starterReferences]
  );

  const configuredNames = useMemo(
    () => new Set(credentials.map((credential) => credential.name)),
    [credentials]
  );

  const referenceRows = useMemo(() => {
    const names = Array.from(new Set([...starterReferences, ...connectorReferences]));
    return names.map((referenceName) => ({
      configured: configuredNames.has(referenceName),
      name: referenceName,
      source: starterReferenceSet.has(referenceName) ? "starter" : "connector",
      ...(REFERENCE_COPY[referenceName] ?? {
        label: referenceName.startsWith("ACSA_SMTP_") ? "Email delivery" : "Connector setup",
        description:
          starterReferenceSet.has(referenceName)
            ? "Used by starter workflows."
            : "Used by installed connectors."
      })
    }));
  }, [configuredNames, connectorReferences, starterReferenceSet, starterReferences]);

  async function refresh() {
    setIsLoading(true);
    try {
      const [credentialResponse, connectorResponse] = await Promise.all([
        fetchCredentials(),
        fetchEngineJson<ConnectorInventoryResponse>("/api/connectors")
      ]);
      setCredentials(credentialResponse.credentials);
      setConnectorInventory(connectorResponse);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load credentials");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSave() {
    if (!name.trim() || !value.trim()) {
      setError("Credential name and value are required.");
      return;
    }

    const normalizedName = name.trim().toUpperCase();
    const normalizedValue = value.trim();

    setIsSaving(true);
    try {
      await saveCredential(normalizedName, normalizedValue);
      setName("");
      setValue("");
      setEditingName(null);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save credential");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(credentialName: string) {
    setRemovingName(credentialName);
    try {
      await removeCredential(credentialName);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to delete credential");
    } finally {
      setRemovingName(null);
    }
  }

  function startReplace(credentialName: string) {
    setEditingName(credentialName);
    setName(credentialName);
    setValue("");
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[60px] items-center justify-between gap-4 border-b border-black/10 bg-white px-5">
        <div>
          <h1 className="section-title mt-2">Credentials</h1>
          <p className="mt-0.5 text-sm text-[#68707a]">Store API keys and secrets once, then reuse them across workflows and connector packs.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="ui-badge">{credentials.length} stored</span>
          <span className="ui-badge">{referenceRows.filter((item) => item.configured).length} configured</span>
          <button className="ui-button" onClick={() => void refresh()} type="button">
            Refresh
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="sleek-scroll min-h-0 overflow-y-auto border-r border-black/10">
          {error ? (
            <div className="border-b border-rose-400/18 bg-rose-50 px-5 py-3 text-sm leading-6 text-[#c65a72]">
              {error}
            </div>
          ) : null}

          <section className="border-b border-black/10 px-5 py-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="section-kicker">Add credential</p>
                <h2 className="mt-1 text-sm font-semibold text-[#101a1d]">
                  Save a value once and use it anywhere Acsa expects a named credential.
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#5f6870]">
                  Existing environment variables still win if the same name is already set on the machine.
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]">
              <label className="sr-only" htmlFor="credential-name-input">
                Credential name
              </label>
              <input
                id="credential-name-input"
                className="ui-input"
                onChange={(event) => setName(event.target.value.toUpperCase())}
                placeholder="OPENAI_API_KEY"
                value={name}
              />
              <label className="sr-only" htmlFor="credential-value-input">
                {editingName ? `Replace value for ${editingName}` : "Credential value"}
              </label>
              <input
                id="credential-value-input"
                className="ui-input"
                onChange={(event) => setValue(event.target.value)}
                placeholder={
                  editingName
                    ? `Replace value for ${editingName}`
                    : "Paste credential value"
                }
                type="password"
                value={value}
              />
              <button
                className="ui-button ui-button-primary justify-center"
                disabled={isSaving}
                onClick={() => void handleSave()}
                type="button"
              >
                {isSaving ? "Saving..." : editingName ? "Replace" : "Save"}
              </button>
            </div>
          </section>

          <section className="px-5 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="section-kicker">Saved credentials</p>
              {isLoading ? <span className="ui-meta">Loading</span> : null}
            </div>

            <div className="space-y-3">
              {credentials.length > 0 ? (
                credentials.map((credential) => (
                  <article
                    className="rounded-[14px] border border-black/10 bg-white px-4 py-3"
                    key={credential.name}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-[#101a1d]">
                            {credential.name}
                          </h3>
                          {credential.is_overridden_by_env ? (
                            <span className="ui-badge">env overrides</span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm leading-6 text-[#5f6870]">
                          Updated {formatRelativeDate(credential.updated_at)}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          className="ui-button"
                          onClick={() => startReplace(credential.name)}
                          type="button"
                        >
                          Replace
                        </button>
                        <button
                          className="ui-button ui-button-danger"
                          disabled={removingName === credential.name}
                          onClick={() => void handleDelete(credential.name)}
                          type="button"
                        >
                          {removingName === credential.name ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-[14px] border border-dashed border-black/10 bg-white/55 px-4 py-5 text-sm leading-6 text-[#6c747d]">
                  No credentials saved yet. Add one above to unlock starter workflows and installed connector packs without extra local shell setup.
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="sleek-scroll min-h-0 overflow-y-auto border-l border-black/10 bg-[rgba(255,255,255,0.82)] px-5 py-5">
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="section-kicker">Needed credentials</p>
              <span className="ui-meta">{referenceRows.length}</span>
            </div>
            <div className="space-y-1.5">
              {referenceRows.map((reference) => (
                <div
                  className="rounded-[10px] border border-black/10 bg-white px-3 py-2"
                  key={reference.name}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold leading-5 text-[#101a1d]">{reference.label}</div>
                      <code className="mt-0.5 block truncate font-mono text-[11px] text-[#5f6870]">{reference.name}</code>
                    </div>
                    <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-[#7a828b]">
                      {reference.configured ? "Configured" : "Needed"}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-5 text-[#6c747d]">
                    {reference.description}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function formatRelativeDate(timestamp: number) {
  const deltaMinutes = Math.max(1, Math.round((Date.now() - timestamp * 1000) / 60000));
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }
  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d ago`;
}
