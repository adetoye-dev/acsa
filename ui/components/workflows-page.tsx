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

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { fetchEngineJson } from "../lib/engine-client";
import type { InvalidWorkflowFile, WorkflowSummary } from "../lib/workflow-editor";

type WorkflowInventoryResponse = {
  invalid_files: InvalidWorkflowFile[];
  workflows: WorkflowSummary[];
};

export function WorkflowsPage() {
  const [inventory, setInventory] = useState<WorkflowInventoryResponse>({
    invalid_files: [],
    workflows: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filteredWorkflows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return inventory.workflows;
    }

    return inventory.workflows.filter((workflow) =>
      [workflow.name, workflow.file_name, workflow.trigger_type]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [inventory.workflows, search]);

  useEffect(function loadWorkflowInventoryOnMountEffect() {
    void refreshInventory();
  }, []);

  async function refreshInventory() {
    setIsLoading(true);
    try {
      const response = await fetchEngineJson<WorkflowInventoryResponse>("/api/workflows");
      setInventory(response);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load workflows");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <header className="flex h-[60px] items-center justify-between gap-4 border-b border-black/10 bg-[rgba(255,255,255,0.72)] px-6">
        <h1 className="section-title mt-2">Workflows</h1>
        <div className="flex items-center gap-2">
          <button className="ui-button" onClick={() => void refreshInventory()} type="button">
            Refresh
          </button>
          <Link className="ui-button ui-button-primary" href="/workflows/new">
            New workflow
          </Link>
        </div>
      </header>

      <div className="grid min-h-0 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-r border-black/10 bg-[rgba(255,255,255,0.42)]">
          <div className="flex flex-wrap items-center gap-3 border-b border-black/10 px-6 py-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/62">
              <span className="ui-badge">{inventory.workflows.length} workflows</span>
              <span className="ui-badge">{inventory.invalid_files.length} invalid</span>
              <span className="ui-badge">
                {inventory.workflows.filter((workflow) => workflow.has_connector_steps).length} connector
              </span>
            </div>

            <div className="ml-auto w-full max-w-sm">
              <input
                className="ui-input"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search workflows"
                type="text"
                value={search}
              />
            </div>
          </div>

          <div className="sleek-scroll min-h-0 overflow-y-auto px-4 py-4">
            {error ? (
              <div className="rounded-[12px] border border-rose-400/20 bg-rose-50 px-4 py-3 text-sm leading-6 text-[#c65a72]">
                {error}
              </div>
            ) : isLoading ? (
              <DirectoryEmptyState>Loading workflow inventory…</DirectoryEmptyState>
            ) : filteredWorkflows.length ? (
              <div className="space-y-2.5">
                {filteredWorkflows.map((workflow) => (
                  <WorkflowRow key={workflow.id} workflow={workflow} />
                ))}
              </div>
            ) : (
              <DirectoryEmptyState>
                {inventory.workflows.length
                  ? "No workflows matched the current search."
                  : "No workflows have been created yet. Start a new one from this page."}
              </DirectoryEmptyState>
            )}
          </div>
        </section>

        <aside className="grid min-h-0 grid-rows-[60px_minmax(0,1fr)] bg-[rgba(255,255,255,0.6)]">
          <div className="flex h-[60px] items-center border-b border-black/10 px-5">
            <div className="text-sm font-medium tracking-tight text-ink">Validation</div>
          </div>

          <div className="sleek-scroll min-h-0 overflow-y-auto px-5 py-5">
            {inventory.invalid_files.length ? (
              <div className="space-y-3">
                {inventory.invalid_files.map((file) => (
                  <div
                    key={file.id}
                    className="rounded-[12px] border border-rose-400/18 bg-white px-4 py-3"
                  >
                    <div className="text-sm font-semibold text-ink">{file.file_name}</div>
                    <div className="mt-2 text-sm leading-6 text-[#c65a72]">{file.error}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[12px] border border-black/10 bg-white px-4 py-4">
                <div className="text-sm font-semibold text-ink">No invalid workflow files</div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function WorkflowRow({ workflow }: { workflow: WorkflowSummary }) {
  return (
    <Link
      className="flex items-start justify-between gap-4 rounded-[12px] border border-black/10 bg-white px-4 py-3 transition hover:border-black/15 hover:bg-white/92"
      href={`/workflows/${workflow.id}`}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-ink">{workflow.name}</div>
        <div className="mt-1 text-xs text-slate">{workflow.file_name}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-slate/62">
          <span>{workflow.step_count} steps</span>
          <span className="text-slate/35">•</span>
          <span>{workflow.trigger_type}</span>
          {workflow.has_connector_steps ? (
            <>
              <span className="text-slate/35">•</span>
              <span>connector</span>
            </>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

function DirectoryEmptyState({ children }: { children: string }) {
  return (
    <div className="flex min-h-[240px] items-center justify-center rounded-[12px] border border-dashed border-black/10 bg-white/70 px-6 text-center text-sm leading-6 text-slate">
      {children}
    </div>
  );
}
