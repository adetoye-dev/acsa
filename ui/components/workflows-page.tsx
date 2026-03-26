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
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { fetchEngineJson } from "../lib/engine-client";
import type { ConnectorInventoryResponse } from "../lib/connectors";
import {
  readRecentWorkflows,
  recordRecentWorkflowOpen,
  writeRecentWorkflows
} from "../lib/recent-workflows";
import {
  createLocalWorkflowDocumentFromYaml,
  type InvalidWorkflowFile,
  type WorkflowSummary
} from "../lib/workflow-editor";
import {
  importHasOpenableDraft,
  nextImportedWorkflowId,
  type N8nImportResponse
} from "../lib/n8n-import";
import {
  buildCompactInventory,
  buildContinueWhereLeftOff,
  mergeLaunchpadWorkflows,
  resolveLaunchpadEmptyState,
  resolveStarterReadiness,
  type ContinueWhereLeftOffItem,
  type StarterReadinessItem
} from "../lib/workflows-home";
import { WORKFLOW_STARTERS } from "../lib/workflow-starters";
import { useWorkflowActions, useWorkflowStore } from "../lib/workflow-store";
import {
  AllWorkflowsPanel,
  type AllWorkflowsPanelEmptyState
} from "./workflows-home/all-workflows-panel";
import { N8nImportPanel } from "./workflows-home/n8n-import-panel";
import {
  RecentWorkflowsPanel
} from "./workflows-home/recent-workflows-panel";
import { StarterTemplatesRail } from "./workflows-home/starter-templates-rail";

type WorkflowInventoryResponse = {
  invalid_files: InvalidWorkflowFile[];
  workflows: WorkflowSummary[];
};

type LaunchpadState = AllWorkflowsPanelEmptyState;

export function WorkflowsPage() {
  const router = useRouter();
  const documents = useWorkflowStore(
    useShallow((state) => state.documents)
  );
  const { patch, setDocuments, setWorkflows } = useWorkflowActions();
  const [inventory, setInventory] = useState<WorkflowInventoryResponse>({
    invalid_files: [],
    workflows: []
  });
  const [connectorInventory, setConnectorInventory] =
    useState<ConnectorInventoryResponse | null>(null);
  const [recentEntries, setRecentEntries] = useState<
    ReturnType<typeof readRecentWorkflows>
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isImportPanelOpen, setIsImportPanelOpen] = useState(false);

  useEffect(function loadLaunchpadDataOnMountEffect() {
    void refreshLaunchpadData();
  }, []);

  const availableWorkflows = useMemo(
    () => mergeLaunchpadWorkflows(inventory.workflows, documents),
    [documents, inventory.workflows]
  );

  const continueWhereLeftOff = useMemo<ContinueWhereLeftOffItem[]>(
    () => buildContinueWhereLeftOff(availableWorkflows, recentEntries),
    [availableWorkflows, recentEntries]
  );

  const compactWorkflows = useMemo(
    () => buildCompactInventory(availableWorkflows, continueWhereLeftOff.map((item) => item.workflow.id)),
    [availableWorkflows, continueWhereLeftOff]
  );

  const starterReadiness = useMemo<StarterReadinessItem[]>(
    () => resolveStarterReadiness(WORKFLOW_STARTERS, connectorInventory),
    [connectorInventory]
  );

  const launchpadState = useMemo<LaunchpadState>(
    () => resolveLaunchpadEmptyState(availableWorkflows, recentEntries),
    [availableWorkflows, recentEntries]
  );

  const readyStarterCount = starterReadiness.filter((starter) => starter.ready).length;

  async function refreshLaunchpadData() {
    setIsLoading(true);
    try {
      setRecentEntries(readRecentWorkflows(window.localStorage));
      const [workflowResponse, connectorResponse] = await Promise.all([
        fetchEngineJson<WorkflowInventoryResponse>("/api/workflows"),
        fetchEngineJson<ConnectorInventoryResponse>("/api/connectors")
      ]);
      setInventory(workflowResponse);
      setConnectorInventory(connectorResponse);
      setError(null);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Failed to load workflows"
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleOpenImportedDraft(result: N8nImportResponse) {
    if (!importHasOpenableDraft(result)) {
      return;
    }

    let document;
    try {
      const workflowId = nextImportedWorkflowId(
        result.workflow_id || result.workflow_name,
        availableWorkflows,
        documents
      );
      document = createLocalWorkflowDocumentFromYaml(workflowId, result.yaml);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to open translated workflow draft"
      );
      return;
    }

    setDocuments((current) => ({
      ...current,
      [document.id]: document
    }));
    setWorkflows((current) => {
      const existingIndex = current.findIndex((workflow) => workflow.id === document.id);
      if (existingIndex === -1) {
        return [...current, document.summary].sort((left, right) =>
          left.file_name.localeCompare(right.file_name)
        );
      }

      const nextWorkflows = [...current];
      nextWorkflows[existingIndex] = document.summary;
      return nextWorkflows;
    });

    try {
      const currentRecents = readRecentWorkflows(window.localStorage);
      const nextRecents = recordRecentWorkflowOpen(currentRecents, {
        fileName: document.summary.file_name,
        name: document.summary.name,
        openedAt: Date.now(),
        workflowId: document.id
      });
      writeRecentWorkflows(window.localStorage, nextRecents);
      setRecentEntries(nextRecents);
    } catch {
      // Ignore storage failures; the imported draft still opens normally.
    }

    patch({
      activeWorkflowId: document.id,
      globalError: null,
      lastAction: `Imported ${document.summary.file_name}`,
      selectedNodeId: null
    });
    setIsImportPanelOpen(false);
    router.push(`/workflows/${document.id}`);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[60px] items-center justify-between gap-4 border-b border-black/10 bg-white px-5">
        <div className="min-w-0">
          <h1 className="section-title mt-2">Workflows</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="ui-badge">{continueWhereLeftOff.length} recent</span>
          <span className="ui-badge">{availableWorkflows.length} workflows</span>
          <span className="ui-badge">{readyStarterCount} starters ready</span>
          <button className="ui-button" onClick={() => void refreshLaunchpadData()} type="button">
            Refresh
          </button>
          <button
            className="ui-button"
            onClick={() => setIsImportPanelOpen((current) => !current)}
            type="button"
          >
            {isImportPanelOpen ? "Close import" : "Import n8n"}
          </button>
          <Link className="ui-button ui-button-primary" href="/workflows/new">
            New workflow
          </Link>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {isImportPanelOpen ? (
          <N8nImportPanel
            onClose={() => setIsImportPanelOpen(false)}
            onOpenDraft={handleOpenImportedDraft}
          />
        ) : null}

        {error ? (
          <div className="border-b border-rose-400/18 bg-rose-50 px-5 py-3 text-sm leading-6 text-[#c65a72]">
            {error}
          </div>
        ) : null}

        <div className="grid h-full min-h-0 xl:grid-cols-[minmax(0,1fr)_372px]">
          <div className="grid min-h-0 border-r border-black/10 grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
            <RecentWorkflowsPanel
              emptyState={launchpadState}
              isLoading={isLoading}
              items={continueWhereLeftOff}
            />
            <AllWorkflowsPanel
              emptyState={launchpadState}
              invalidFiles={inventory.invalid_files}
              isLoading={isLoading}
              workflows={compactWorkflows}
            />
          </div>

          <StarterTemplatesRail
            emptyState={launchpadState}
            items={starterReadiness}
            primary={launchpadState === "empty"}
          />
        </div>
      </div>
    </div>
  );
}
