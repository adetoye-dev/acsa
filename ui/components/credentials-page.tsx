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
    label: "SMTP Sender",
    description: "Sender email address for outgoing SMTP emails."
  },
  ACSA_SMTP_HOST: {
    label: "SMTP Host",
    description: "Hostname of your SMTP email server."
  },
  ACSA_SMTP_PASSWORD: {
    label: "SMTP Password",
    description: "App password or password secret for your SMTP server."
  },
  ACSA_SMTP_PORT: {
    label: "SMTP Port",
    description: "Connection port for SMTP (typically 465 or 587)."
  },
  ACSA_SMTP_TLS: {
    label: "SMTP Secure/TLS",
    description: "Security mode to use for SMTP connection (e.g. ssl, starttls)."
  },
  ACSA_SMTP_USERNAME: {
    label: "SMTP Username",
    description: "Authentication username for your SMTP server."
  },
  ACSA_SMTP_TIMEOUT_SECS: {
    label: "SMTP Timeout",
    description: "Timeout duration in seconds for sending emails."
  },
  ACSA_DEMO_EMAIL_TO: {
    label: "Demo Recipient",
    description: "Default email address to send automated demo reports to."
  },
  FIRECRAWL_API_KEY: {
    label: "Firecrawl Scraper",
    description: "API key used to crawl and scrape startup websites."
  },
  GOOGLE_SHEETS_CREDENTIALS_PATH: {
    label: "Google Sheets Key Path",
    description: "Absolute path to your Google Sheets Service Account JSON key."
  },
  GOOGLE_SHEETS_CREDENTIALS_JSON: {
    label: "Google Sheets Key JSON",
    description: "Raw JSON string or Base64-encoded credentials for Google Sheets."
  }
};

export function CredentialsPage() {
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [envKeys, setEnvKeys] = useState<string[]>([]);
  const [connectorInventory, setConnectorInventory] = useState<ConnectorInventoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [deletingNames, setDeletingNames] = useState<Set<string>>(() => new Set());

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

  const existingNames = useMemo(
    () => new Set([...credentials.map((credential) => credential.name), ...envKeys]),
    [credentials, envKeys]
  );

  const referenceRows = useMemo(() => {
    const names = Array.from(new Set([...starterReferences, ...connectorReferences]));
    return names.map((referenceName) => ({
      configured: existingNames.has(referenceName),
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
  }, [existingNames, connectorReferences, starterReferenceSet, starterReferences]);

  const missingCredentials = useMemo(
    () => referenceRows.filter((row) => !row.configured),
    [referenceRows]
  );

  async function loadPageData() {
    const [credentialResponse, connectorResponse] = await Promise.all([
      fetchCredentials(),
      fetchEngineJson<ConnectorInventoryResponse>("/api/connectors")
    ]);
    setCredentials(credentialResponse.credentials);
    setEnvKeys(credentialResponse.env_keys ?? []);
    setConnectorInventory(connectorResponse);
  }

  async function refresh() {
    setIsLoading(true);
    try {
      await loadPageData();
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
    const normalizedValue = value;

    setIsSaving(true);
    try {
      try {
        await saveCredential(normalizedName, normalizedValue);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Failed to save credential");
        return;
      }

      setName("");
      setValue("");
      setEditingName(null);
      try {
        await loadPageData();
        setError(null);
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? `Credential saved but refresh failed: ${nextError.message}`
            : "Credential saved but failed to refresh credentials"
        );
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(credentialName: string) {
    if (isSaving) {
      return;
    }

    setDeletingNames((current) => {
      const next = new Set(current);
      next.add(credentialName);
      return next;
    });
    try {
      try {
        await removeCredential(credentialName);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Failed to delete credential");
        return;
      }

      try {
        await loadPageData();
        setError(null);
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? `Credential deleted but refresh failed: ${nextError.message}`
            : "Credential deleted but failed to refresh credentials"
        );
      }
    } finally {
      setDeletingNames((current) => {
        const next = new Set(current);
        next.delete(credentialName);
        return next;
      });
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
            <div className="border-b border-rose-400/18 bg-rose-50 px-5 py-3 text-sm leading-6 text-[#c65a72]" role="alert">
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
                          disabled={isSaving || deletingNames.has(credential.name)}
                          onClick={() => startReplace(credential.name)}
                          type="button"
                        >
                          Replace
                        </button>
                        <button
                          className="ui-button ui-button-danger"
                          disabled={isSaving || deletingNames.has(credential.name)}
                          onClick={() => void handleDelete(credential.name)}
                          type="button"
                        >
                          {deletingNames.has(credential.name) ? "Deleting..." : "Delete"}
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
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-black/[0.04] pb-3">
              <p className="section-kicker">Missing Credentials</p>
              {missingCredentials.length > 0 ? (
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-amber-600 bg-amber-500/10 border border-amber-500/15 px-2 py-0.5 rounded-[6px]">
                  {missingCredentials.length} missing
                </span>
              ) : (
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-green-600 bg-green-500/10 border border-green-500/15 px-2 py-0.5 rounded-[6px]">
                  All Set
                </span>
              )}
            </div>
            <div className="space-y-2.5">
              {missingCredentials.length > 0 ? (
                missingCredentials.map((reference) => (
                  <div
                    className="rounded-[12px] border border-amber-500/12 bg-amber-500/[0.01] px-4 py-3.5 shadow-sm transition-all hover:bg-amber-500/[0.02]"
                    key={reference.name}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13.5px] font-bold leading-5 text-[#101a1d]">{reference.label}</div>
                        <code className="mt-1 block truncate font-mono text-[11px] text-amber-800 bg-amber-500/10 px-1.5 py-0.5 rounded-[4px] w-fit">{reference.name}</code>
                      </div>
                      <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-amber-600 bg-amber-500/15 px-1.5 py-0.5 rounded-[6px] shrink-0">
                        Missing
                      </span>
                    </div>
                    <p className="mt-2 text-[12px] leading-5 text-[#5f6870]">
                      {reference.description}
                    </p>
                  </div>
                ))
              ) : (
                <div className="rounded-[16px] border border-green-500/10 bg-green-500/[0.02] p-5 text-center shadow-sm">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10 text-green-600 mb-3">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
                    </svg>
                  </div>
                  <h3 className="text-[14px] font-bold text-green-800">All Configured</h3>
                  <p className="mt-1.5 text-[12px] text-green-700/80 leading-5">
                    Your active workflows and connectors have full access to all required environment variables and keys.
                  </p>
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function formatRelativeDate(timestamp: number) {
  const deltaMinutes = Math.round((Date.now() - timestamp * 1000) / 60000);
  if (deltaMinutes <= 0) {
    return "just now";
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }
  const deltaHours = Math.max(1, Math.floor(deltaMinutes / 60));
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }
  const deltaDays = Math.max(1, Math.floor(deltaHours / 24));
  return `${deltaDays}d ago`;
}
