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
  type InvalidWorkflowFile,
  type HumanTask,
  type RunSummary,
  type WorkflowDocumentResponse,
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
  const { clearTaskValue, patch, setTaskValue } = useWorkflowActions();
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
  const [resolvingTaskIds, setResolvingTaskIds] = useState<Record<string, boolean>>({});

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
  const showCenteredEmptyState =
    !isLoading &&
    orderedWorkflows.length === 0 &&
    inventory.invalid_files.length === 0 &&
    pendingTasks.length === 0;

  async function refreshLaunchpadData() {
    setIsLoading(true);
    patch({ isRefreshingTasks: true });
    try {
      setRecentEntries(readRecentWorkflows(window.localStorage));
      const [workflowResult, taskResult] = await Promise.allSettled([
        fetchEngineJson<WorkflowInventoryResponse>("/api/workflows"),
        fetchEngineJson<HumanTaskResponse>("/human-tasks")
      ]);
      let workflowsError: string | null = null;
      let tasksError: string | null = null;

      if (workflowResult.status === "fulfilled") {
        setInventory(workflowResult.value);
      } else {
        workflowsError =
          workflowResult.reason instanceof Error
            ? workflowResult.reason.message
            : "Failed to load workflows";
      }

      if (taskResult.status === "fulfilled") {
        const fetchedPendingTasks = Array.isArray(taskResult.value?.tasks)
          ? taskResult.value.tasks
          : [];
        patch({ pendingTasks: fetchedPendingTasks });
      } else {
        patch({ pendingTasks: [] });
        tasksError =
          taskResult.reason instanceof Error
            ? taskResult.reason.message
            : "Failed to load human tasks";
      }

      if (workflowsError || tasksError) {
        setError([workflowsError, tasksError].filter(Boolean).join("; "));
      } else {
        setError(null);
      }
    } finally {
      patch({ isRefreshingTasks: false });
      setIsLoading(false);
    }
  }

  async function handleOpenImportedDraft(result: N8nImportResponse) {
    if (!importHasOpenableDraft(result)) {
      return;
    }

    try {
      const workflowId = nextImportedWorkflowId(
        result.workflow_id || result.workflow_name,
        availableWorkflows,
        documents
      );
      const response = await fetchEngineJson<WorkflowDocumentResponse>("/api/workflows", {
        body: JSON.stringify({
          id: workflowId,
          yaml: result.yaml
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });

      const currentRecents = readRecentWorkflows(window.localStorage);
      const nextRecents = recordRecentWorkflowOpen(currentRecents, {
        fileName: response.summary.file_name,
        name: response.summary.name,
        openedAt: Date.now(),
        workflowId: response.id
      });
      writeRecentWorkflows(window.localStorage, nextRecents);
      setRecentEntries(nextRecents);
      setInventory((current) => ({
        ...current,
        workflows: [
          response.summary,
          ...current.workflows.filter((workflow) => workflow.id !== response.id)
        ]
      }));
      setIsImportPanelOpen(false);
      router.push(`/workflows/${response.id}`);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to import translated workflow"
      );
    }
  }

  async function handleResolveApproval(taskId: string, approved: boolean) {
    if (resolvingTaskIds[taskId]) {
      return;
    }
    setResolvingTaskIds((current) => ({ ...current, [taskId]: true }));
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
    } finally {
      setResolvingTaskIds((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
    }
  }

  async function handleResolveManualInput(taskId: string) {
    if (resolvingTaskIds[taskId]) {
      return;
    }
    const value = taskValues[taskId] ?? "";
    if (!value.trim()) {
      setError("Enter a value before resolving this task.");
      return;
    }

    setResolvingTaskIds((current) => ({ ...current, [taskId]: true }));

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
    } finally {
      setResolvingTaskIds((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[60px] items-center justify-between gap-4 border-b border-black/10 bg-white px-5">
        <div className="min-w-0">
          <h1 className="section-title mt-2">Workflows</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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

        {showCenteredEmptyState ? (
          <div 
            className="flex h-full min-h-0 items-center justify-center bg-gradient-to-br from-[#f8f9fb] to-[#f1f3f7] px-6 py-10 shadow-[inset_0_2px_12px_rgba(0,0,0,0.02)]"
            style={{
              backgroundImage: `radial-gradient(rgba(111, 99, 255, 0.08) 1.5px, transparent 1.5px)`,
              backgroundSize: `24px 24px`,
            }}
          >
            <div className="flex max-w-md flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#f6f2ff] text-[#6f63ff]">
                <StartAutomationIcon />
              </div>
              <h2 className="mt-5 text-[30px] font-semibold tracking-[-0.035em] text-ink">
                Start automating
              </h2>
              <p className="mt-3 text-[15px] leading-7 text-slate">
                Create your first workflow and build powerful automations directly from the app.
              </p>
              <Link className="ui-button ui-button-primary mt-6" href="/workflows/new">
                Create your first workflow
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid h-full min-h-0 xl:grid-cols-[minmax(0,1fr)_372px]">
            <section 
              className="min-h-0 border-r border-black/5 bg-gradient-to-br from-[#f8f9fb] to-[#f1f3f7] shadow-[inset_0_2px_12px_rgba(0,0,0,0.02)] relative"
              style={{
                backgroundImage: `radial-gradient(rgba(111, 99, 255, 0.08) 1.5px, transparent 1.5px)`,
                backgroundSize: `24px 24px`,
              }}
            >
              <div className="sleek-scroll min-h-0 overflow-y-auto px-5 py-6">
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
              onError={(message) => setError(message)}
              onRefresh={() => void refreshLaunchpadData()}
              onResolveValue={(taskId) => void handleResolveManualInput(taskId)}
              onValueChange={(taskId, value) => setTaskValue(taskId, value)}
              resolvingTaskIds={resolvingTaskIds}
              taskValues={taskValues}
              tasks={pendingTasks}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function StartAutomationIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
      <path
        d="M12 4.5v4m0 7v4m7.5-7.5h-4m-7 0h-4M16.95 7.05l-2.82 2.82m-4.26 4.26-2.82 2.82m9.9 0-2.82-2.82m-4.26-4.26L7.05 7.05"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
