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
import {
  readRecentWorkflows,
  recordRecentWorkflowOpen,
  writeRecentWorkflows
} from "../lib/recent-workflows";
import {
  createLocalWorkflowDocumentFromYaml,
  type InvalidWorkflowFile,
  type HumanTask,
  type RunSummary,
  type WorkflowSummary
} from "../lib/workflow-editor";
import {
  importHasOpenableDraft,
  nextImportedWorkflowId,
  type N8nImportResponse
} from "../lib/n8n-import";
import {
  buildRecentFirstWorkflowInventory,
  mergeLaunchpadWorkflows,
} from "../lib/workflows-home";
import { useWorkflowActions, useWorkflowStore } from "../lib/workflow-store";
import { N8nImportPanel } from "./workflows-home/n8n-import-panel";
import { PendingTasksRail } from "./workflows-home/pending-tasks-rail";
import { WorkflowGridCard } from "./workflows-home/workflow-grid-card";

type WorkflowInventoryResponse = {
  invalid_files: InvalidWorkflowFile[];
  workflows: WorkflowSummary[];
};

type HumanTaskResponse = {
  tasks: HumanTask[];
};

export function WorkflowsPage() {
  const router = useRouter();
  const {
    documents,
    isRefreshingTasks,
    pendingTasks,
    taskValues
  } = useWorkflowStore(
    useShallow((state) => ({
      documents: state.documents,
      isRefreshingTasks: state.isRefreshingTasks,
      pendingTasks: state.pendingTasks,
      taskValues: state.taskValues
    }))
  );
  const { clearTaskValue, patch, setDocuments, setTaskValue, setWorkflows } =
    useWorkflowActions();
  const [inventory, setInventory] = useState<WorkflowInventoryResponse>({
    invalid_files: [],
    workflows: []
  });
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

  const orderedWorkflows = useMemo(
    () => buildRecentFirstWorkflowInventory(availableWorkflows, recentEntries),
    [availableWorkflows, recentEntries]
  );

  const recentByWorkflowId = useMemo(
    () => new Map(recentEntries.map((entry) => [entry.workflowId, entry.openedAt])),
    [recentEntries]
  );

  async function refreshLaunchpadData() {
    setIsLoading(true);
    patch({ isRefreshingTasks: true });
    try {
      setRecentEntries(readRecentWorkflows(window.localStorage));
      const [workflowResponse, taskResponse] = await Promise.all([
        fetchEngineJson<WorkflowInventoryResponse>("/api/workflows"),
        fetchEngineJson<HumanTaskResponse>("/human-tasks")
      ]);
      setInventory(workflowResponse);
      const pendingTasks = Array.isArray(taskResponse?.tasks) ? taskResponse.tasks : [];
      patch({ pendingTasks });
      setError(null);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Failed to load workflows"
      );
    } finally {
      patch({ isRefreshingTasks: false });
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
      return nextWorkflows.sort((left, right) =>
        left.file_name.localeCompare(right.file_name)
      );
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

  async function handleResolveApproval(taskId: string, approved: boolean) {
    try {
      await fetchEngineJson<RunSummary>(`/human-tasks/${taskId}/resolve`, {
        body: JSON.stringify({ approved }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      clearTaskValue(taskId);
      await refreshLaunchpadData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to resolve task");
    }
  }

  async function handleResolveManualInput(taskId: string) {
    const value = taskValues[taskId] ?? "";
    if (!value.trim()) {
      setError("Enter a value before resolving this task.");
      return;
    }

    try {
      await fetchEngineJson<RunSummary>(`/human-tasks/${taskId}/resolve`, {
        body: JSON.stringify({ value }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      clearTaskValue(taskId);
      await refreshLaunchpadData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to resolve task");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[60px] items-center justify-between gap-4 border-b border-black/10 bg-white px-5">
        <div className="min-w-0">
          <h1 className="section-title mt-2">Workflows</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="ui-badge">{availableWorkflows.length} workflows</span>
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
          <section className="grid min-h-0 grid-rows-[60px_minmax(0,1fr)] border-r border-black/10 bg-white">
            <div className="flex items-center justify-between gap-4 border-b border-black/10 px-5">
              <div className="text-[15px] font-medium tracking-tight text-ink">
                Your workflows
              </div>
              <span className="ui-badge">{orderedWorkflows.length}</span>
            </div>

            <div className="sleek-scroll min-h-0 overflow-y-auto px-5 py-5">
              {inventory.invalid_files.length > 0 ? (
                <div className="mb-4 rounded-[16px] border border-rose-400/18 bg-rose-50/70 px-4 py-3 text-sm leading-6 text-[#c65a72]">
                  {inventory.invalid_files.length} invalid workflow file
                  {inventory.invalid_files.length === 1 ? "" : "s"} need attention.
                </div>
              ) : null}

              {isLoading ? (
                <div className="rounded-[18px] border border-black/10 bg-white px-5 py-8 text-sm leading-6 text-slate">
                  Loading workflows…
                </div>
              ) : orderedWorkflows.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                  {orderedWorkflows.map((workflow) => (
                    <WorkflowGridCard
                      href={`/workflows/${workflow.id}`}
                      key={workflow.id}
                      recentOpenedAt={recentByWorkflowId.get(workflow.id) ?? null}
                      workflow={workflow}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-[18px] border border-black/10 bg-white px-5 py-8 text-sm leading-6 text-slate">
                  No workflows yet. Create one or import an existing n8n flow.
                </div>
              )}
            </div>
          </section>

          <PendingTasksRail
            isRefreshing={isRefreshingTasks}
            onApprove={(taskId, approved) => void handleResolveApproval(taskId, approved)}
            onRefresh={() => void refreshLaunchpadData()}
            onResolveValue={(taskId) => void handleResolveManualInput(taskId)}
            onValueChange={(taskId, value) => setTaskValue(taskId, value)}
            taskValues={taskValues}
            tasks={pendingTasks}
          />
        </div>
      </div>
    </div>
  );
}
