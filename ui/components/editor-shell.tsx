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

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  type Edge,
  type XYPosition
} from "@xyflow/react";

import { ExecutionDebugger } from "./execution-debugger";
import { ExecutionInspector } from "./execution-inspector";
import { NodeBrowser } from "./node-browser";
import { NodeInspector } from "./node-inspector";
import { TopBar, type WorkspaceView } from "./top-bar";
import { WorkflowCanvas } from "./workflow-canvas";
import {
  fetchEngineJson,
  fetchEngineNoContent,
  fetchEngineText
} from "../lib/engine-client";
import {
  formatDuration,
  parseMetricsSummary,
  type LogPageResponse,
  type MetricsSummary,
  type RunDetailResponse,
  type RunPageResponse
} from "../lib/observability";
import {
  observabilityStoreState,
  useObservabilityActions,
  useObservabilityStore
} from "../lib/observability-store";
import {
  addStepAfterNode,
  addStepToWorkflow,
  autoLayoutWorkflow,
  createLocalWorkflowDocument,
  defaultStepParamsForType,
  defaultTriggerDetailsForType,
  extractTriggerDetails,
  formatYaml,
  parseObjectYaml,
  type RunStartResponse,
  type CanvasNode,
  type HumanTask,
  type InvalidWorkflowFile,
  type NodeExecutionState,
  type StepTypeEntry,
  type TriggerTypeEntry,
  TRIGGER_NODE_ID,
  type WorkflowDocument,
  type WorkflowDocumentResponse,
  type WorkflowSummary,
  workflowHasRunnableSteps,
  workflowDocumentFromResponse,
  workflowToCanvas,
  workflowToYaml,
  updateWorkflowEdges,
  removeStepFromWorkflow,
  insertStepBetweenNodes,
  slugifyIdentifier,
  summarizeWorkflow,
  withStepUpdated
} from "../lib/workflow-editor";
import {
  useWorkflowActions,
  useWorkflowStore,
  workflowStoreState
} from "../lib/workflow-store";

type NodeCatalogResponse = {
  step_types: StepTypeEntry[];
  trigger_types: TriggerTypeEntry[];
};

type WorkflowInventoryResponse = {
  invalid_files: InvalidWorkflowFile[];
  workflows: WorkflowSummary[];
};

type HumanTaskResponse = {
  tasks: HumanTask[];
};

type AddStepIntent =
  | { mode: "detached" }
  | { mode: "after"; sourceNodeId: string }
  | { mode: "between"; sourceId: string; targetId: string };

export function EditorShell() {
  const {
    activeWorkflowId,
    documents,
    globalError,
    inspectorError,
    invalidFiles,
    isBooting,
    isLoadingWorkflow,
    isRefreshingTasks,
    isRunning,
    isSaving,
    pendingTasks,
    runStatus,
    selectedNodeId,
    stepCatalog,
    stepParamsDraft,
    triggerCatalog,
    triggerDetailsDraft,
    workflows
  } = useWorkflowStore(
    useShallow((state) => ({
      activeWorkflowId: state.activeWorkflowId,
      documents: state.documents,
      globalError: state.globalError,
      inspectorError: state.inspectorError,
      invalidFiles: state.invalidFiles,
      isBooting: state.isBooting,
      isLoadingWorkflow: state.isLoadingWorkflow,
      isRefreshingTasks: state.isRefreshingTasks,
      isRunning: state.isRunning,
      isSaving: state.isSaving,
      pendingTasks: state.pendingTasks,
      runStatus: state.runStatus,
      selectedNodeId: state.selectedNodeId,
      stepCatalog: state.stepCatalog,
      stepParamsDraft: state.stepParamsDraft,
      triggerCatalog: state.triggerCatalog,
      triggerDetailsDraft: state.triggerDetailsDraft,
      workflows: state.workflows
    }))
  );
  const {
    isRefreshingHistory,
    logLevelFilter,
    logSearch,
    metrics,
    runDetail,
    runLogs,
    runPage,
    runStatusFilter,
    selectedRunId
  } = useObservabilityStore(
    useShallow((state) => ({
      isRefreshingHistory: state.isRefreshingHistory,
      logLevelFilter: state.logLevelFilter,
      logSearch: state.logSearch,
      metrics: state.metrics,
      runDetail: state.runDetail,
      runLogs: state.logs,
      runPage: state.runPage,
      runStatusFilter: state.runStatusFilter,
      selectedRunId: state.selectedRunId
    }))
  );
  const { patch: patchWorkflowState, setDocuments, setWorkflows } = useWorkflowActions();
  const { patch: patchObservabilityState } = useObservabilityActions();

  const activeWorkflow = activeWorkflowId ? documents[activeWorkflowId] ?? null : null;
  const [centerView, setCenterView] = useState<WorkspaceView>("canvas");
  const [frameRequestKey, setFrameRequestKey] = useState(0);
  const [isAddStepMenuOpen, setIsAddStepMenuOpen] = useState(false);
  const [addStepIntent, setAddStepIntent] = useState<AddStepIntent>({ mode: "detached" });
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  const [liveRunDetail, setLiveRunDetail] = useState<RunDetailResponse | null>(null);
  const [executionFrameRequestKey, setExecutionFrameRequestKey] = useState(0);
  const [executionDetailPane, setExecutionDetailPane] = useState<"input" | "logs" | "output">(
    "output"
  );
  const [selectedExecutionStepId, setSelectedExecutionStepId] = useState<string | null>(null);
  const canvas = useMemo(
    () =>
      activeWorkflow
        ? workflowToCanvas(activeWorkflow.workflow, activeWorkflow.positions, stepCatalog)
        : { edges: [] as Edge[], nodes: [] as CanvasNode[], positions: {} },
    [activeWorkflow, stepCatalog]
  );
  const displayNodes = useMemo(
    () => decorateNodesForSelectedRun(canvas.nodes, activeWorkflow, liveRunDetail),
    [activeWorkflow, canvas.nodes, liveRunDetail]
  );
  const canvasNodeLookup = useMemo(
    () => new Map(canvas.nodes.map((node) => [node.id, node])),
    [canvas.nodes]
  );
  const nodeBrowserHint = useMemo(() => {
    if (addStepIntent.mode === "after") {
      return `Add after ${
        canvasNodeLookup.get(addStepIntent.sourceNodeId)?.data.label ?? "selected node"
      }`;
    }

    if (addStepIntent.mode === "between") {
      const sourceLabel =
        canvasNodeLookup.get(addStepIntent.sourceId)?.data.label ?? "source node";
      const targetLabel =
        canvasNodeLookup.get(addStepIntent.targetId)?.data.label ?? "target node";
      return `Insert between ${sourceLabel} and ${targetLabel}`;
    }

    return "Create an unconnected draft step";
  }, [addStepIntent, canvasNodeLookup]);
  const selectedNode =
    selectedNodeId === null
      ? null
      : displayNodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedStep =
    selectedNode?.data.kind === "step"
      ? activeWorkflow?.workflow.steps.find((step) => step.id === selectedNode.id) ?? null
      : null;
  const isBusy =
    isBooting ||
    isLoadingWorkflow ||
    isRefreshingHistory ||
    isRefreshingTasks ||
    isRunning ||
    isSaving;
  const saveDisabledReason = saveDisabledMessage(activeWorkflow);
  const runDisabledReason = runDisabledMessage(activeWorkflow);
  const canSave = !isSaving && !saveDisabledReason;
  const canRun = !isRunning && !runDisabledReason;

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (isBooting) {
      return;
    }
    void refreshRunHistory(selectedRunId);
  }, [isBooting, runStatusFilter, selectedRunId]);

  useEffect(() => {
    if (!activeWorkflow) {
      setLiveRunId(null);
      setLiveRunDetail(null);
      return;
    }

    if (liveRunDetail && liveRunDetail.run.workflow_name !== activeWorkflow.workflow.name) {
      setLiveRunId(null);
      setLiveRunDetail(null);
    }
  }, [activeWorkflow, liveRunDetail]);

  useEffect(() => {
    if (!activeWorkflow) {
      patchWorkflowState({
        inspectorError: null,
        stepParamsDraft: "{}",
        triggerDetailsDraft: "{}"
      });
      return;
    }

    const nextWorkflowDraftState: {
      inspectorError: string | null;
      stepParamsDraft: string;
      triggerDetailsDraft: string;
    } = {
      inspectorError: null,
      stepParamsDraft: "{}",
      triggerDetailsDraft: formatYaml(extractTriggerDetails(activeWorkflow.workflow.trigger))
    };

    if (selectedNode?.data.kind === "step") {
      const selectedStep = activeWorkflow.workflow.steps.find(
        (step) => step.id === selectedNode.id
      );
      nextWorkflowDraftState.stepParamsDraft = formatYaml(selectedStep?.params ?? {});
    }

    patchWorkflowState(nextWorkflowDraftState);
  }, [activeWorkflow, selectedNode?.data.kind, selectedNode?.id]);

  useEffect(() => {
    if (isBooting || !selectedRunId) {
      if (!selectedRunId) {
        patchObservabilityState({
          logs: null,
          runDetail: null
        });
      }
      return;
    }
    void loadRunDetail(selectedRunId);
  }, [isBooting, logLevelFilter, logSearch, selectedRunId]);

  useEffect(() => {
    if (!liveRunId || !isRunning) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const detail = await loadLiveRunDetail(liveRunId);
      if (cancelled) {
        return;
      }

      if (!detail || detail.run.id !== liveRunId) {
        timer = setTimeout(poll, 900);
        return;
      }

      setLiveRunDetail(detail);

      if (detail.run.status === "running") {
        timer = setTimeout(poll, 900);
        return;
      }

      patchWorkflowState({
        isRunning: false,
        lastAction:
          detail.run.status === "paused"
            ? `Run paused with ${detail.human_tasks.filter((task) => task.status === "pending").length} pending task(s)`
            : detail.run.status === "failed"
              ? "Workflow run failed"
              : `Run completed successfully (${detail.step_runs.filter((stepRun) => stepRun.status === "success").length} steps)`,
        lastRun:
          detail.run.status === "success" || detail.run.status === "paused"
            ? {
                completed_steps: detail.step_runs.filter((stepRun) => stepRun.status === "success")
                  .length,
                pending_tasks: detail.human_tasks
                  .filter((task) => task.status === "pending")
                  .map((task) => ({
                    field: task.field,
                    id: task.id,
                    kind: task.kind,
                    prompt: task.prompt,
                    step_id: task.step_id
                  })),
                run_id: detail.run.id,
                status: detail.run.status,
                workflow_name: detail.run.workflow_name
              }
            : null,
        runStatus: null
      });
      setLiveRunId(null);
      await refreshHumanTasks();
      await refreshRunHistory(detail.run.id, detail.run.workflow_name);
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isRunning, liveRunId]);

  useEffect(() => {
    setExecutionDetailPane("output");
  }, [selectedRunId]);

  useEffect(() => {
    if (centerView !== "history") {
      return;
    }
    setExecutionFrameRequestKey((current) => current + 1);
  }, [centerView, selectedRunId]);

  async function bootstrap() {
    patchWorkflowState({
      globalError: null,
      isBooting: true
    });
    try {
      const [catalog, inventory, tasks] = await Promise.all([
        fetchEngineJson<NodeCatalogResponse>("/api/node-catalog"),
        fetchEngineJson<WorkflowInventoryResponse>("/api/workflows"),
        fetchEngineJson<HumanTaskResponse>("/human-tasks")
      ]);

      patchWorkflowState({
        invalidFiles: inventory.invalid_files,
        newStepType: catalog.step_types[0]?.type_name ?? "noop",
        pendingTasks: tasks.tasks,
        stepCatalog: catalog.step_types,
        triggerCatalog: catalog.trigger_types,
        workflows: mergeWorkflowSummaries({}, inventory.workflows)
      });

      const preferredWorkflowId =
        inventory.workflows.find(
          (workflow) => workflow.id === workflowStoreState().activeWorkflowId
        )?.id ??
        inventory.workflows[0]?.id ??
        null;
      patchWorkflowState({ activeWorkflowId: preferredWorkflowId });
      let workflowName: string | null = null;
      if (preferredWorkflowId) {
        const response = await loadWorkflowDocument(preferredWorkflowId);
        workflowName = response?.summary.name ?? null;
      }
      await refreshRunHistory(undefined, workflowName);
      patchWorkflowState({
        lastAction: "Loaded workflow inventory, node catalog, and pending tasks"
      });
    } catch (error) {
      patchWorkflowState({
        globalError: errorMessage(error),
        lastAction: "Failed to reach the engine API"
      });
    } finally {
      patchWorkflowState({ isBooting: false });
    }
  }

  async function loadWorkflowDocument(workflowId: string) {
    patchWorkflowState({ isLoadingWorkflow: true });
    try {
      const response = await fetchEngineJson<WorkflowDocumentResponse>(
        `/api/workflows/${workflowId}`
      );
      applyWorkflowResponse(response);
      patchWorkflowState({ lastAction: `Opened ${response.summary.file_name}` });
      return response;
    } catch (error) {
      patchWorkflowState({
        globalError: errorMessage(error),
        lastAction: `Failed to load ${workflowId}.yaml`
      });
      return null;
    } finally {
      patchWorkflowState({ isLoadingWorkflow: false });
    }
  }

  async function refreshHumanTasks() {
    patchWorkflowState({ isRefreshingTasks: true });
    try {
      const response = await fetchEngineJson<HumanTaskResponse>("/human-tasks");
      patchWorkflowState({ pendingTasks: response.tasks });
    } catch (error) {
      patchWorkflowState({ globalError: errorMessage(error) });
    } finally {
      patchWorkflowState({ isRefreshingTasks: false });
    }
  }

  async function refreshInventory(preferredWorkflowId?: string | null) {
    const inventory = await fetchEngineJson<WorkflowInventoryResponse>("/api/workflows");
    const localDraftDocuments = workflowStoreState().documents;
    const workflows = mergeWorkflowSummaries(localDraftDocuments, inventory.workflows);
    patchWorkflowState({
      invalidFiles: inventory.invalid_files,
      workflows
    });
    const nextWorkflowId =
      workflows.find((workflow) => workflow.id === preferredWorkflowId)?.id ??
      workflows[0]?.id ??
      null;
    patchWorkflowState({ activeWorkflowId: nextWorkflowId });
    return nextWorkflowId;
  }

  async function refreshRunHistory(
    preferredRunId?: string | null,
    workflowNameOverride?: string | null
  ) {
    const currentObservabilityState = observabilityStoreState();
    patchObservabilityState({ isRefreshingHistory: true });
    try {
      const query = new URLSearchParams();
      const workflowName =
        workflowNameOverride?.trim() ?? activeWorkflow?.workflow.name.trim() ?? "";
      if (workflowName) {
        query.set("workflow_name", workflowName);
      }
      if (currentObservabilityState.runStatusFilter.trim()) {
        query.set("status", currentObservabilityState.runStatusFilter.trim());
      }
      query.set("page", "1");
      query.set("page_size", "12");

      const [pageResponse, metricsText] = await Promise.all([
        fetchEngineJson<RunPageResponse>(`/api/runs?${query.toString()}`),
        fetchEngineText("/metrics")
      ]);

      const nextRunId =
        preferredRunId ??
        (currentObservabilityState.selectedRunId
          ? pageResponse.runs.find(
              (run) => run.id === currentObservabilityState.selectedRunId
            )?.id
          : undefined) ??
        null;
      patchObservabilityState({
        isRefreshingHistory: false,
        logs: nextRunId ? currentObservabilityState.logs : null,
        metrics: parseMetricsSummary(metricsText),
        runDetail:
          nextRunId && currentObservabilityState.runDetail?.run.id === nextRunId
            ? currentObservabilityState.runDetail
            : null,
        runPage: pageResponse,
        selectedRunId: nextRunId
      });
    } catch (error) {
      patchWorkflowState({ globalError: errorMessage(error) });
    } finally {
      patchObservabilityState({ isRefreshingHistory: false });
    }
  }

  async function loadRunDetail(runId: string) {
    const currentObservabilityState = observabilityStoreState();
    try {
      const [detailResponse, logResponse] = await Promise.all([
        fetchEngineJson<RunDetailResponse>(`/api/runs/${runId}`),
        fetchEngineJson<LogPageResponse>(
          `/api/runs/${runId}/logs?${new URLSearchParams({
            ...(currentObservabilityState.logLevelFilter
              ? { level: currentObservabilityState.logLevelFilter }
              : {}),
            ...(currentObservabilityState.logSearch
              ? { search: currentObservabilityState.logSearch }
              : {}),
            page: "1",
            page_size: "80"
          }).toString()}`
        )
      ]);
      patchObservabilityState({
        logs: logResponse,
        runDetail: detailResponse
      });
      return detailResponse;
    } catch (error) {
      patchWorkflowState({ globalError: errorMessage(error) });
      return null;
    }
  }

  async function loadLiveRunDetail(runId: string) {
    try {
      return await fetchEngineJson<RunDetailResponse>(`/api/runs/${runId}`);
    } catch (error) {
      patchWorkflowState({ globalError: errorMessage(error) });
      return null;
    }
  }

  function applyActiveWorkflowUpdate(
    updater: (document: WorkflowDocument) => WorkflowDocument
  ) {
    if (!activeWorkflow) {
      return;
    }
    const nextDocument = persistDocumentLayout(finalizeDocument(updater(activeWorkflow)));
    setDocuments((current) => ({
      ...current,
      [nextDocument.id]: nextDocument
    }));
    setWorkflows((current) =>
      current.map((workflow) =>
        workflow.id === nextDocument.id ? nextDocument.summary : workflow
      )
    );
  }

  function applyWorkflowResponse(response: WorkflowDocumentResponse) {
    setDocuments((current) => ({
      ...current,
      [response.id]: persistDocumentLayout(
        workflowDocumentFromResponse(
          response,
          current[response.id],
          readStoredWorkflowPositions(response.id)
        )
      )
    }));
    setWorkflows((current) => upsertWorkflowSummary(current, response.summary));
  }

  async function handleCreateWorkflow() {
    const workflowId = nextDraftWorkflowId(workflows);
    const document = persistDocumentLayout(createLocalWorkflowDocument(workflowId));
    setDocuments((current) => ({
      ...current,
      [document.id]: document
    }));
    setWorkflows((current) => upsertWorkflowSummary(current, document.summary));
    patchWorkflowState({
      activeWorkflowId: document.id,
      globalError: null,
      lastAction: `Created ${document.summary.file_name} draft`,
      selectedNodeId: TRIGGER_NODE_ID
    });
    await refreshRunHistory(undefined, document.workflow.name);
  }

  async function handleDeleteWorkflow(workflowId: string) {
    if (!window.confirm(`Delete ${workflowId}.yaml?`)) {
      return;
    }

    const document = documents[workflowId];
    if (document?.localDraft) {
      setDocuments((current) => {
        const nextDocuments = { ...current };
        delete nextDocuments[workflowId];
        return nextDocuments;
      });
      setWorkflows((current) => current.filter((workflow) => workflow.id !== workflowId));
      clearStoredWorkflowPositions(workflowId);
      const nextWorkflowId = nextSelectableWorkflowId(
        workflows.filter((workflow) => workflow.id !== workflowId),
        activeWorkflowId === workflowId ? null : activeWorkflowId
      );
      patchWorkflowState({
        activeWorkflowId: nextWorkflowId,
        globalError: null,
        lastAction: `Discarded ${workflowId}.yaml draft`,
        selectedNodeId: null
      });
      if (nextWorkflowId && !workflowStoreState().documents[nextWorkflowId]) {
        const response = await loadWorkflowDocument(nextWorkflowId);
        await refreshRunHistory(undefined, response?.summary.name ?? nextWorkflowId);
      } else {
        await refreshRunHistory(
          undefined,
          nextWorkflowId ? workflowStoreState().documents[nextWorkflowId]?.workflow.name ?? null : null
        );
      }
      return;
    }

    try {
      await fetchEngineNoContent(`/api/workflows/${workflowId}`, {
        method: "DELETE"
      });
      setDocuments((current) => {
        const nextDocuments = { ...current };
        delete nextDocuments[workflowId];
        return nextDocuments;
      });
      clearStoredWorkflowPositions(workflowId);
      const nextWorkflowId = await refreshInventory(
        activeWorkflowId === workflowId ? null : activeWorkflowId
      );
      let workflowName: string | null = null;
      if (nextWorkflowId) {
        const draftDocument = workflowStoreState().documents[nextWorkflowId];
        if (draftDocument?.localDraft) {
          workflowName = draftDocument.workflow.name;
        } else {
          const response = await loadWorkflowDocument(nextWorkflowId);
          workflowName = response?.summary.name ?? null;
        }
      }
      await refreshRunHistory(undefined, workflowName);
      patchWorkflowState({
        globalError: null,
        lastAction: `Deleted ${workflowId}.yaml`,
        selectedNodeId: null
      });
    } catch (error) {
      patchWorkflowState({
        globalError: errorMessage(error),
        lastAction: `Failed to delete ${workflowId}.yaml`
      });
    }
  }

  async function handleDuplicateWorkflow(workflowId: string) {
    const proposedId = window.prompt("Duplicate into", `${workflowId}-copy`);
    if (!proposedId) {
      return;
    }
    const targetId = slugifyIdentifier(proposedId);
    if (workflows.some((workflow) => workflow.id === targetId)) {
      patchWorkflowState({
        globalError: `A workflow named ${targetId}.yaml already exists.`,
        lastAction: "Workflow duplication failed"
      });
      return;
    }

    const localSource = documents[workflowId];
    if (localSource?.localDraft) {
      const duplicateDocument = persistDocumentLayout(
        finalizeDocument({
          ...localSource,
          dirty: true,
          id: targetId,
          localDraft: true,
          summary: summarizeWorkflow(targetId, localSource.workflow, {
            localDraft: true
          }),
          workflow: {
            ...localSource.workflow,
            name: `${localSource.workflow.name} copy`
          }
        })
      );
      setDocuments((current) => ({
        ...current,
        [targetId]: duplicateDocument
      }));
      setWorkflows((current) => upsertWorkflowSummary(current, duplicateDocument.summary));
      patchWorkflowState({
        activeWorkflowId: targetId,
        globalError: null,
        lastAction: `Duplicated ${workflowId}.yaml to ${duplicateDocument.summary.file_name}`,
        selectedNodeId: null
      });
      await refreshRunHistory(undefined, duplicateDocument.workflow.name);
      return;
    }

    try {
      const response = await fetchEngineJson<WorkflowDocumentResponse>(
        `/api/workflows/${workflowId}/duplicate`,
        {
          body: JSON.stringify({ target_id: targetId }),
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        }
      );
      applyWorkflowResponse(response);
      patchWorkflowState({
        activeWorkflowId: response.id,
        globalError: null,
        lastAction: `Duplicated ${workflowId}.yaml to ${response.summary.file_name}`,
        selectedNodeId: null
      });
      await refreshInventory(response.id);
      await refreshRunHistory(undefined, response.summary.name);
    } catch (error) {
      patchWorkflowState({
        globalError: errorMessage(error),
        lastAction: "Workflow duplication failed"
      });
    }
  }

  async function handleRenameWorkflow(workflowId: string) {
    const document = documents[workflowId];
    const currentName =
      document?.workflow.name ??
      workflows.find((workflow) => workflow.id === workflowId)?.name ??
      workflowId;
    const proposedName = window.prompt("Rename workflow", currentName);
    if (!proposedName) {
      return;
    }

    const nextName = proposedName.trim();
    if (!nextName) {
      patchWorkflowState({
        globalError: "Workflow names must not be empty.",
        lastAction: "Workflow rename failed"
      });
      return;
    }

    const targetId = slugifyIdentifier(nextName);
    if (
      workflows.some(
        (workflow) => workflow.id === targetId && workflow.id !== workflowId
      )
    ) {
      patchWorkflowState({
        globalError: `A workflow named ${targetId}.yaml already exists.`,
        lastAction: "Workflow rename failed"
      });
      return;
    }

    if (document?.localDraft) {
      const renamedDocument = finalizeDocument({
        ...document,
        id: targetId,
        localDraft: true,
        summary: summarizeWorkflow(targetId, document.workflow, {
          localDraft: true
        }),
        workflow: {
          ...document.workflow,
          name: nextName
        }
      });
      setDocuments((current) => {
        const nextDocuments = { ...current };
        delete nextDocuments[workflowId];
        nextDocuments[targetId] = renamedDocument;
        return nextDocuments;
      });
      setWorkflows((current) => {
        const nextWorkflows = current.filter((workflow) => workflow.id !== workflowId);
        return upsertWorkflowSummary(nextWorkflows, renamedDocument.summary);
      });
      clearStoredWorkflowPositions(workflowId);
      patchWorkflowState({
        activeWorkflowId: activeWorkflowId === workflowId ? targetId : activeWorkflowId,
        globalError: null,
        lastAction: `Renamed ${workflowId}.yaml to ${renamedDocument.summary.file_name}`
      });
      return;
    }

    try {
      const response = await fetchEngineJson<WorkflowDocumentResponse>(
        `/api/workflows/${workflowId}/rename`,
        {
          body: JSON.stringify({
            name: nextName,
            target_id: targetId,
            ...(document ? { yaml: workflowToYaml({ ...document.workflow, name: nextName }) } : {})
          }),
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        }
      );
      setDocuments((current) => {
        const nextDocuments = { ...current };
        if (workflowId !== response.id) {
          delete nextDocuments[workflowId];
        }
        nextDocuments[response.id] = persistDocumentLayout(
          workflowDocumentFromResponse(
            response,
            current[workflowId] ?? current[response.id],
            readStoredWorkflowPositions(response.id)
          )
        );
        return nextDocuments;
      });
      setWorkflows((current) => {
        const nextWorkflows = current.filter((workflow) => workflow.id !== workflowId);
        return upsertWorkflowSummary(nextWorkflows, response.summary);
      });
      clearStoredWorkflowPositions(workflowId);
      patchWorkflowState({
        activeWorkflowId: activeWorkflowId === workflowId ? response.id : activeWorkflowId,
        globalError: null,
        lastAction: `Renamed ${workflowId}.yaml to ${response.summary.file_name}`
      });
      await refreshInventory(activeWorkflowId === workflowId ? response.id : activeWorkflowId);
      await refreshRunHistory(undefined, response.summary.name);
    } catch (error) {
      patchWorkflowState({
        globalError: errorMessage(error),
        lastAction: "Workflow rename failed"
      });
    }
  }

  function handleEdgesCommit(nextEdges: Edge[]) {
    if (!activeWorkflow) {
      return;
    }
    applyActiveWorkflowUpdate((document) => ({
      ...document,
      workflow: updateWorkflowEdges(document.workflow, nextEdges)
    }));
    patchWorkflowState({ lastAction: "Updated workflow connections" });
  }

  function handleAttachStepToTrigger(stepId: string) {
    if (!activeWorkflow) {
      return;
    }

    applyActiveWorkflowUpdate((document) => ({
      ...document,
      workflow: {
        ...document.workflow,
        ...(document.workflow.ui?.detached_steps?.includes(stepId)
          ? {
              ui: {
                ...document.workflow.ui,
                detached_steps: (document.workflow.ui?.detached_steps ?? []).filter(
                  (candidate) => candidate !== stepId
                )
              }
            }
          : {})
      }
    }));
    patchWorkflowState({ lastAction: `Attached ${stepId} to the workflow trigger` });
  }

  function handlePositionsCommit(nextPositions: Record<string, XYPosition>) {
    if (!activeWorkflow) {
      return;
    }
    applyActiveWorkflowUpdate((document) => ({
      ...document,
      positions: nextPositions
    }));
    patchWorkflowState({ lastAction: "Updated node positions" });
  }

  function handleRequestAddAfterNode(nodeId: string) {
    setAddStepIntent({ mode: "after", sourceNodeId: nodeId });
    setIsAddStepMenuOpen(true);
  }

  function handleRequestInsertBetween(sourceId: string, targetId: string) {
    setAddStepIntent({ mode: "between", sourceId, targetId });
    setIsAddStepMenuOpen(true);
  }

  function handleAddStep(typeName: string) {
    if (!activeWorkflow) {
      return;
    }
    const { selectedNodeId: createdNodeId, workflow } =
      addStepIntent.mode === "after"
        ? addStepAfterNode(activeWorkflow.workflow, typeName, addStepIntent.sourceNodeId)
        : addStepIntent.mode === "between"
          ? insertStepBetweenNodes(
              activeWorkflow.workflow,
              typeName,
              addStepIntent.sourceId,
              addStepIntent.targetId
            )
          : addStepToWorkflow(activeWorkflow.workflow, typeName);
    applyActiveWorkflowUpdate((document) => ({
      ...document,
      workflow
    }));
    patchWorkflowState({
      lastAction: `Added ${typeName.replace(/_/g, " ")} step`,
      selectedNodeId: createdNodeId
    });
    setAddStepIntent({ mode: "detached" });
    setIsAddStepMenuOpen(false);
  }

  function handleAutoLayout() {
    if (!activeWorkflow) {
      return;
    }
    applyActiveWorkflowUpdate((document) => ({
      ...document,
      positions: autoLayoutWorkflow(document.workflow)
    }));
    patchWorkflowState({ lastAction: "Auto-arranged workflow nodes" });
  }

  async function handleRefresh() {
    try {
      const nextWorkflowId = await refreshInventory(activeWorkflowId);
      await refreshHumanTasks();
      const workflowIdToLoad = nextWorkflowId ?? activeWorkflowId;
      let workflowName: string | null = activeWorkflow?.workflow.name ?? null;
      if (workflowIdToLoad) {
        const draftDocument = workflowStoreState().documents[workflowIdToLoad];
        if (draftDocument?.localDraft) {
          workflowName = draftDocument.workflow.name;
        } else {
          const response = await loadWorkflowDocument(workflowIdToLoad);
          workflowName = response?.summary.name ?? workflowName;
        }
      }
      await refreshRunHistory(selectedRunId, workflowName);
      patchWorkflowState({
        globalError: null,
        lastAction: "Refreshed workflow inventory, tasks, and run history"
      });
    } catch (error) {
      patchWorkflowState({
        globalError: errorMessage(error),
        lastAction: "Refresh failed"
      });
    }
  }

  async function handleRun() {
    if (!activeWorkflow) {
      return;
    }
    if (runDisabledReason) {
      patchWorkflowState({
        globalError: runDisabledReason,
        lastAction: "Workflow run blocked"
      });
      return;
    }
    patchWorkflowState({
      isRunning: true,
      lastAction: "Workflow run started",
      lastRun: null,
      runStatus: null
    });
    setLiveRunDetail(null);
    setLiveRunId(null);
    patchObservabilityState({
      logs: null,
      runDetail: null,
      selectedRunId: null
    });
    try {
      const response = await fetchEngineJson<RunStartResponse>(
        `/api/workflows/${activeWorkflow.id}/run-async`,
        {
          body: JSON.stringify({ payload: {} }),
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        }
      );
      patchWorkflowState({
        globalError: null
      });
      setLiveRunId(response.run_id);
      patchObservabilityState({ selectedRunId: response.run_id });
      await refreshRunHistory(response.run_id, response.workflow_name);
    } catch (error) {
      setLiveRunId(null);
      setLiveRunDetail(null);
      patchWorkflowState({
        globalError: errorMessage(error),
        isRunning: false,
        lastAction: "Workflow run failed",
        runStatus: "failed"
      });
    }
  }

  async function handleSave() {
    if (!activeWorkflow) {
      return;
    }
    if (saveDisabledReason) {
      patchWorkflowState({
        globalError: saveDisabledReason,
        lastAction: "Save blocked"
      });
      return;
    }
    patchWorkflowState({ isSaving: true });
    try {
      const response = await fetchEngineJson<WorkflowDocumentResponse>(
        activeWorkflow.localDraft ? "/api/workflows" : `/api/workflows/${activeWorkflow.id}`,
        {
          body: JSON.stringify(
            activeWorkflow.localDraft
              ? { id: activeWorkflow.id, yaml: activeWorkflow.yaml }
              : { yaml: activeWorkflow.yaml }
          ),
          headers: {
            "content-type": "application/json"
          },
          method: activeWorkflow.localDraft ? "POST" : "PUT"
        }
      );
      applyWorkflowResponse(response);
      if (activeWorkflow.localDraft) {
        setDocuments((current) => {
          const nextDocuments = { ...current };
          nextDocuments[response.id] = {
            ...(nextDocuments[response.id] ?? workflowDocumentFromResponse(response)),
            localDraft: false
          };
          return nextDocuments;
        });
      }
      patchWorkflowState({
        activeWorkflowId: response.id,
        globalError: null,
        lastAction: `Saved ${response.summary.file_name}`,
        selectedNodeId
      });
      await refreshInventory(response.id);
    } catch (error) {
      patchWorkflowState({
        globalError: errorMessage(error),
        lastAction: "Save failed"
      });
    } finally {
      patchWorkflowState({ isSaving: false });
    }
  }

  async function handleSelectWorkflow(workflowId: string) {
    patchWorkflowState({
      activeWorkflowId: workflowId,
      globalError: null,
      selectedNodeId: null
    });
    if (!documents[workflowId]) {
      const response = await loadWorkflowDocument(workflowId);
      await refreshRunHistory(selectedRunId, response?.summary.name ?? workflowId);
      return;
    }
    await refreshRunHistory(selectedRunId, documents[workflowId].workflow.name);
    patchWorkflowState({ lastAction: `Opened ${workflowId}.yaml` });
  }

  function handleTriggerTypeChange(triggerType: string) {
    if (!activeWorkflow) {
      return;
    }
    applyActiveWorkflowUpdate((document) => ({
      ...document,
      workflow: {
        ...document.workflow,
        trigger: {
          type: triggerType,
          ...defaultTriggerDetailsForType(triggerType, document.id)
        }
      }
    }));
    patchWorkflowState({
      lastAction: `Updated trigger type to ${triggerType}`,
      triggerDetailsDraft: formatYaml(defaultTriggerDetailsForType(triggerType, activeWorkflow.id))
    });
  }

  function handleTriggerDetailsChange(text: string) {
    patchWorkflowState({ triggerDetailsDraft: text });
    if (!activeWorkflow) {
      return;
    }

    try {
      const details = parseObjectYaml(text);
      applyActiveWorkflowUpdate((document) => ({
        ...document,
        workflow: {
          ...document.workflow,
          trigger: {
            type: document.workflow.trigger.type,
            ...details
          }
        }
      }));
      patchWorkflowState({ inspectorError: null });
    } catch (error) {
      patchWorkflowState({ inspectorError: errorMessage(error) });
    }
  }

  function handleSelectedNodeIdChange(value: string) {
    if (!activeWorkflow || !selectedNode || selectedNode.data.kind !== "step") {
      return;
    }
    const nextId = slugifyIdentifier(value);
    if (!nextId) {
      patchWorkflowState({ inspectorError: "Step ids must not be empty." });
      return;
    }
    if (
      activeWorkflow.workflow.steps.some(
        (step) => step.id === nextId && step.id !== selectedNode.id
      )
    ) {
      patchWorkflowState({ inspectorError: `A step named ${nextId} already exists.` });
      return;
    }

    applyActiveWorkflowUpdate((document) => ({
      ...document,
      positions: renamePositionKey(document.positions, selectedNode.id, nextId),
      workflow: {
        ...document.workflow,
        ...(document.workflow.ui?.detached_steps?.includes(selectedNode.id)
          ? {
              ui: {
                ...document.workflow.ui,
                detached_steps: (document.workflow.ui?.detached_steps ?? []).map((stepId) =>
                  stepId === selectedNode.id ? nextId : stepId
                )
              }
            }
          : {}),
        steps: document.workflow.steps.map((step) => ({
          ...step,
          id: step.id === selectedNode.id ? nextId : step.id,
          next: step.next.map((candidate) =>
            candidate === selectedNode.id ? nextId : candidate
          )
        }))
      }
    }));
    patchWorkflowState({
      inspectorError: null,
      lastAction: `Renamed step ${selectedNode.id} to ${nextId}`,
      selectedNodeId: nextId
    });
  }

  function handleSelectedNodeTypeChange(typeName: string) {
    if (!selectedNode || selectedNode.data.kind !== "step") {
      return;
    }
    applyActiveWorkflowUpdate((document) => ({
      ...document,
      workflow: withStepUpdated(document.workflow, selectedNode.id, (step) => ({
        ...step,
        params: defaultStepParamsForType(typeName),
        type: typeName
      }))
    }));
    patchWorkflowState({
      inspectorError: null,
      lastAction: `Changed ${selectedNode.id} to ${typeName}`
    });
  }

  function handleSelectedNodeTimeoutChange(value: string) {
    if (!selectedNode || selectedNode.data.kind !== "step") {
      return;
    }
    const timeout = value.trim() ? Number(value) : undefined;
    applyActiveWorkflowUpdate((document) => ({
      ...document,
      workflow: withStepUpdated(document.workflow, selectedNode.id, (step) => ({
        ...step,
        timeout_ms:
          timeout !== undefined && Number.isFinite(timeout) ? timeout : undefined
      }))
    }));
  }

  function handleSelectedNodeRetryAttemptsChange(value: string) {
    if (!selectedNode || selectedNode.data.kind !== "step") {
      return;
    }
    applyActiveWorkflowUpdate((document) => ({
      ...document,
      workflow: withStepUpdated(document.workflow, selectedNode.id, (step) => {
        const attempts = value.trim() ? Number(value) : undefined;
        if (attempts === undefined || !Number.isFinite(attempts) || attempts <= 0) {
          return { ...step, retry: undefined };
        }
        return {
          ...step,
          retry: {
            attempts,
            ...(step.retry?.backoff_ms !== undefined
              ? { backoff_ms: step.retry.backoff_ms }
              : {})
          }
        };
      })
    }));
  }

  function handleSelectedNodeRetryBackoffChange(value: string) {
    if (!selectedNode || selectedNode.data.kind !== "step") {
      return;
    }
    applyActiveWorkflowUpdate((document) => ({
      ...document,
      workflow: withStepUpdated(document.workflow, selectedNode.id, (step) => {
        const backoff = value.trim() ? Number(value) : undefined;
        if (backoff === undefined || !Number.isFinite(backoff) || backoff < 0) {
          return {
            ...step,
            retry: step.retry ? { attempts: step.retry.attempts } : undefined
          };
        }
        return {
          ...step,
          retry: {
            attempts: step.retry?.attempts ?? 1,
            backoff_ms: backoff
          }
        };
      })
    }));
  }

  function handleSelectedNodeParamsChange(text: string) {
    patchWorkflowState({ stepParamsDraft: text });
    if (!selectedNode || selectedNode.data.kind !== "step") {
      return;
    }

    try {
      const params = parseObjectYaml(text);
      applyActiveWorkflowUpdate((document) => ({
        ...document,
        workflow: withStepUpdated(document.workflow, selectedNode.id, (step) => ({
          ...step,
          params
        }))
      }));
      patchWorkflowState({ inspectorError: null });
    } catch (error) {
      patchWorkflowState({ inspectorError: errorMessage(error) });
    }
  }

  function handleDeleteSelectedNode(stepId?: string) {
    if (!activeWorkflow) {
      return;
    }
    const targetStepId =
      stepId ?? (selectedNode?.data.kind === "step" ? selectedNode.id : null);
    if (!targetStepId) {
      return;
    }

    applyActiveWorkflowUpdate((document) => ({
      ...document,
      positions: omitPosition(document.positions, targetStepId),
      workflow: removeStepFromWorkflow(document.workflow, targetStepId)
    }));
    patchWorkflowState({
      inspectorError: null,
      lastAction: `Removed step ${targetStepId}`,
      selectedNodeId: null
    });
  }

  const showCanvasView = centerView === "canvas";
  const showNodeBrowser = showCanvasView && isAddStepMenuOpen;
  const showExecutionsView = centerView === "history";
  const showPreviewView = centerView === "preview";
  const showRightRail =
    showNodeBrowser ||
    (showCanvasView && Boolean(selectedNode)) ||
    (showExecutionsView && Boolean(selectedRunId));
  const activeRunStatus = isRunning ? "running" : liveRunDetail?.run.status ?? runStatus ?? null;
  const draftNotice = workflowDraftNotice(activeWorkflow);

  return (
    <main className="h-[100dvh] overflow-hidden bg-[#f7f7f8] text-ink">
      <div
        className={`grid h-full ${
          globalError ? "grid-rows-[52px_auto_minmax(0,1fr)]" : "grid-rows-[52px_minmax(0,1fr)]"
        }`}
      >
        <TopBar
          activeWorkflowFile={activeWorkflow?.summary.file_name ?? "No workflow selected"}
          activeView={centerView}
          hasUnsavedChanges={activeWorkflow?.dirty ?? false}
          isRunning={isRunning}
          isSaving={isSaving}
          onChangeView={setCenterView}
          onRefresh={() => void handleRefresh()}
          onRun={() => void handleRun()}
          onSave={() => void handleSave()}
          runDisabled={!canRun}
          runDisabledReason={runDisabledReason}
          saveDisabled={!canSave}
          saveDisabledReason={saveDisabledReason}
        />

        {globalError ? (
          <section className="border-b border-ember/20 bg-[#fff0eb] px-4 py-2.5 text-sm leading-6 text-[#cd694d]">
            {globalError}
          </section>
        ) : null}

        <section
          className={`grid min-h-0 bg-[rgba(255,255,255,0.76)] ${
            showRightRail
              ? "xl:grid-cols-[256px_minmax(0,1fr)_324px]"
              : "xl:grid-cols-[256px_minmax(0,1fr)]"
          }`}
        >
          <aside className="grid min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden border-r border-black/10 bg-[rgba(255,255,255,0.7)]">
            <div className="sleek-scroll flex min-h-0 flex-col overflow-y-auto px-3 py-3">
              <SidebarBlock
                accessory={
                  <button
                    className="ui-button !px-2.5 !py-2 !text-[10px]"
                    disabled={isBusy}
                    onClick={() => void handleCreateWorkflow()}
                    type="button"
                  >
                    New
                  </button>
                }
                title="Workflows"
              >
                <WorkflowList
                  activeWorkflowId={activeWorkflowId}
                  invalidFiles={invalidFiles}
                  isBusy={isBusy}
                  onDeleteWorkflow={(workflowId) => void handleDeleteWorkflow(workflowId)}
                  onDuplicateWorkflow={(workflowId) => void handleDuplicateWorkflow(workflowId)}
                  onRenameWorkflow={(workflowId) => void handleRenameWorkflow(workflowId)}
                  onSelectWorkflow={(workflowId) => void handleSelectWorkflow(workflowId)}
                  workflows={workflows}
                />
              </SidebarBlock>

              <div className="mt-auto border-t border-black/10 px-1 pt-3">
                <SidebarBlock title="Quick status">
                  <SidebarQuickStatus
                    activeRunStatus={activeRunStatus}
                    invalidFileCount={invalidFiles.length}
                    metrics={metrics}
                  />
                </SidebarBlock>
              </div>
            </div>
          </aside>

          <section className="min-h-0 overflow-hidden bg-[rgba(255,255,255,0.7)]">
            {showCanvasView ? (
              <div className="h-full min-h-0 overflow-hidden">
                {activeWorkflow ? (
                  <div className="relative h-full min-h-0 overflow-hidden bg-[#fbfbfc]">
                    <div className="relative h-full min-h-0">
                      <WorkflowCanvas
                        key={activeWorkflow.id}
                        edges={canvas.edges}
                        frameRequestKey={frameRequestKey}
                        nodes={displayNodes}
                        onAttachStepToTrigger={handleAttachStepToTrigger}
                        onDeleteStep={handleDeleteSelectedNode}
                        onEdgesCommit={handleEdgesCommit}
                        onInsertBetween={handleRequestInsertBetween}
                        onPositionsCommit={handlePositionsCommit}
                        onRequestAddAfterNode={handleRequestAddAfterNode}
                        onSelectNode={(nodeId) => {
                          setIsAddStepMenuOpen(false);
                          setAddStepIntent({ mode: "detached" });
                          patchWorkflowState({ selectedNodeId: nodeId });
                        }}
                        showControls={false}
                        showMiniMap={false}
                        showViewportPanel={false}
                      />
                    </div>
                    {draftNotice ? (
                      <div className="pointer-events-none absolute left-3 top-3 z-20 max-w-sm">
                        <div className="rounded-[10px] border border-black/10 bg-white px-3 py-2.5 text-sm leading-6 text-slate shadow-[0_1px_2px_rgba(16,20,20,0.04)]">
                          {draftNotice}
                        </div>
                      </div>
                    ) : null}
                    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end p-3">
                      <div className="pointer-events-auto flex flex-wrap items-center gap-2">
                        <button
                          className="ui-button !px-2.5 !py-2 !text-[10px]"
                          onClick={() => setFrameRequestKey((current) => current + 1)}
                          type="button"
                        >
                          Frame
                        </button>
                        <button
                          className="ui-button !px-2.5 !py-2 !text-[10px]"
                          onClick={handleAutoLayout}
                          type="button"
                        >
                          Auto layout
                        </button>
                      </div>
                    </div>
                    <div className="absolute bottom-3 right-3 z-20">
                      <button
                        aria-expanded={isAddStepMenuOpen}
                        aria-haspopup="menu"
                        aria-label="Add step"
                        className={`flex h-10 w-10 items-center justify-center rounded-[10px] border text-xl shadow-[0_1px_2px_rgba(16,20,20,0.06)] transition ${
                          isAddStepMenuOpen
                            ? "border-[#171b20] bg-[#171b20] text-white"
                            : "border-black/10 bg-white text-[#334155] hover:border-black/20 hover:bg-[#f7f7fb]"
                        }`}
                        onClick={() => {
                          setAddStepIntent({ mode: "detached" });
                          setIsAddStepMenuOpen((current) => !current);
                        }}
                        type="button"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center px-10 text-center text-sm leading-7 text-slate">
                    {isBooting
                      ? "Booting the editor..."
                      : "No valid workflow is loaded yet. Create a new workflow or fix invalid YAML files from the sidebar."}
                  </div>
                )}
              </div>
            ) : showPreviewView ? (
              <div className="min-h-0 overflow-hidden">
                <WorkflowYamlCard
                  fullHeight
                  workflowYaml={activeWorkflow?.yaml ?? ""}
                />
              </div>
            ) : (
              <div className="h-full min-h-0 overflow-hidden">
                <ExecutionDebugger
                  edges={canvas.edges}
                  frameRequestKey={executionFrameRequestKey}
                  isLoading={isRefreshingHistory}
                  nodes={canvas.nodes}
                  onRefresh={() => void refreshRunHistory(selectedRunId)}
                  onRunStatusFilterChange={(value) =>
                    patchObservabilityState({ runStatusFilter: value })
                  }
                  onSelectRun={(runId) => patchObservabilityState({ selectedRunId: runId })}
                  onSelectStepId={setSelectedExecutionStepId}
                  runDetail={runDetail}
                  runPage={runPage}
                  runStatusFilter={runStatusFilter}
                  selectedRunId={selectedRunId}
                  selectedStepId={selectedExecutionStepId}
                  workflowName={activeWorkflow?.workflow.name ?? null}
                />
              </div>
            )}
          </section>

          {showRightRail ? (
            <aside className="grid min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden border-l border-black/10 bg-[rgba(255,255,255,0.72)]">
              {showNodeBrowser ? (
                <NodeBrowser
                  contextHint={nodeBrowserHint}
                  onClose={() => {
                    setAddStepIntent({ mode: "detached" });
                    setIsAddStepMenuOpen(false);
                  }}
                  onSelectType={handleAddStep}
                  stepCatalog={stepCatalog}
                />
              ) : showExecutionsView ? (
                <div className="sleek-scroll min-h-0 overflow-y-auto">
                  <ExecutionInspector
                    detailPane={executionDetailPane}
                    logLevelFilter={logLevelFilter}
                    logSearch={logSearch}
                    logs={runLogs}
                    nodes={canvas.nodes}
                    onDetailPaneChange={setExecutionDetailPane}
                    onLogLevelFilterChange={(value) =>
                      patchObservabilityState({ logLevelFilter: value })
                    }
                    onLogSearchChange={(value) => patchObservabilityState({ logSearch: value })}
                    runDetail={runDetail}
                    selectedStepId={selectedExecutionStepId}
                  />
                </div>
              ) : selectedNode ? (
                <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
                  <div className="border-b border-black/10 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate/60">
                          Selected node
                        </div>
                        {selectedStep ? (
                          <div className="mt-1.5 space-y-1">
                            <input
                              aria-label="Step id"
                              className="w-full rounded-[10px] border border-black/10 bg-white px-2.5 py-1.5 font-mono text-[14px] font-medium tracking-tight text-ink outline-none transition focus:border-[#6f63ff]/45 focus:bg-white focus:ring-1 focus:ring-[#6f63ff]/12 placeholder:text-slate/45"
                              id="selected-step-name"
                              onChange={(event) => handleSelectedNodeIdChange(event.target.value)}
                              placeholder="rename-step"
                              spellCheck={false}
                              type="text"
                              value={selectedStep.id}
                            />
                          </div>
                        ) : selectedNode.data.kind === "trigger" ? (
                          <div className="mt-0.5 text-[15px] font-medium tracking-tight text-ink">
                            Trigger
                          </div>
                        ) : null}
                      </div>
                      {selectedStep ? (
                        <button
                          aria-label={`Delete ${selectedStep.id}`}
                          className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-black/10 bg-white text-slate/70 transition hover:border-ember/25 hover:bg-ember/10 hover:text-ember"
                          onClick={() => handleDeleteSelectedNode(selectedStep.id)}
                          type="button"
                        >
                          <TrashIcon />
                        </button>
                      ) : selectedNode.data.kind === "trigger" ? (
                        <ShellBadge
                          label={activeWorkflow?.workflow.trigger.type ?? "manual"}
                          tone="info"
                        />
                      ) : null}
                    </div>
                  </div>

                  <div className="sleek-scroll min-h-0 overflow-y-auto px-2 py-2">
                    <NodeInspector
                      activeWorkflow={activeWorkflow}
                      inspectorError={inspectorError}
                      onSelectedNodeParamsChange={handleSelectedNodeParamsChange}
                      onSelectedNodeRetryAttemptsChange={handleSelectedNodeRetryAttemptsChange}
                      onSelectedNodeRetryBackoffChange={handleSelectedNodeRetryBackoffChange}
                      onSelectedNodeTimeoutChange={handleSelectedNodeTimeoutChange}
                      onSelectedNodeTypeChange={handleSelectedNodeTypeChange}
                      onTriggerDetailsChange={handleTriggerDetailsChange}
                      onTriggerTypeChange={handleTriggerTypeChange}
                      selectedNode={selectedNode}
                      stepCatalog={stepCatalog}
                      stepParamsDraft={stepParamsDraft}
                      triggerCatalog={triggerCatalog}
                      triggerDetailsDraft={triggerDetailsDraft}
                    />
                  </div>
                </div>
              ) : null}
            </aside>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function SidebarBlock({
  accessory,
  children,
  title
}: {
  accessory?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="mb-3">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/60">
          {title}
        </div>
        {accessory}
      </div>
      {children}
    </section>
  );
}

function ShellBadge({
  label,
  tone
}: {
  label: string;
  tone: "info" | "info-dark" | "neutral" | "neutral-dark" | "warn";
}) {
  const toneMap = {
    info: "border-black/10 bg-white text-[#646b75]",
    "info-dark": "border-black/10 bg-white text-[#5a616b]",
    neutral: "border-black/10 bg-white text-[#76869d]",
    "neutral-dark": "border-black/10 bg-white text-[#6e7680]",
    warn: "border-rose-200 bg-rose-50 text-[#9a5a38]"
  } as const;

  return (
    <span
      className={`rounded-[8px] border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${toneMap[tone]}`}
    >
      {label}
    </span>
  );
}

function SidebarQuickStatus({
  activeRunStatus,
  invalidFileCount,
  metrics
}: {
  activeRunStatus: string | null;
  invalidFileCount: number;
  metrics: MetricsSummary | null;
}) {
  return (
    <div className="space-y-2 px-1">
      <div className="grid grid-cols-3 gap-1.5">
        <StatPill label="runs" tone="violet" value={String(metrics?.workflowRunsTotal ?? 0)} />
        <StatPill label="paused" tone="amber" value={String(metrics?.workflowRunsPaused ?? 0)} />
        <StatPill label="errors" tone="rose" value={String(invalidFileCount)} />
      </div>
      <div className={`rounded-[10px] border px-2.5 py-2 ${runStatusCardClassName(activeRunStatus)}`}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate/60">
          Status
        </div>
        <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-ink">
          {activeRunStatus ? activeRunStatus.split(" • ")[0] : "idle"}
        </div>
      </div>
    </div>
  );
}

function StatPill({
  label,
  tone,
  value
}: {
  label: string;
  tone: "amber" | "rose" | "violet";
  value: string;
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-400/20 bg-[#fdf8eb]"
      : tone === "rose"
        ? "border-rose-400/20 bg-[#fdf1f4]"
        : "border-[#6f63ff]/20 bg-[#f6f4ff]";

  return (
    <div className={`rounded-[8px] border px-2 py-1.5 ${toneClass}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate/60">
        {label}
      </div>
      <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-ink">
        {value}
      </div>
    </div>
  );
}

function runStatusCardClassName(activeRunStatus: string | null) {
  if (!activeRunStatus) {
    return "border-black/10 bg-white/60";
  }

  const status = activeRunStatus.split(" • ")[0];
  switch (status) {
    case "running":
      return "border-[#6f63ff]/24 bg-[#f6f4ff]";
    case "success":
      return "border-emerald-400/18 bg-[#eff9f2]";
    case "failed":
      return "border-rose-400/18 bg-[#fdf1f4]";
    case "paused":
      return "border-amber-400/18 bg-[#fdf8eb]";
    default:
      return "border-black/10 bg-white";
  }
}

function WorkflowList({
  activeWorkflowId,
  invalidFiles,
  isBusy,
  onDeleteWorkflow,
  onDuplicateWorkflow,
  onRenameWorkflow,
  onSelectWorkflow,
  workflows
}: {
  activeWorkflowId: string | null;
  invalidFiles: InvalidWorkflowFile[];
  isBusy: boolean;
  onDeleteWorkflow: (workflowId: string) => void;
  onDuplicateWorkflow: (workflowId: string) => void;
  onRenameWorkflow: (workflowId: string) => void;
  onSelectWorkflow: (workflowId: string) => void;
  workflows: WorkflowSummary[];
}) {
  return (
    <div className="space-y-2">
      {workflows.map((workflow) => {
        const isActive = workflow.id === activeWorkflowId;

        return (
          <article
            key={workflow.id}
            className={`border px-3.5 py-3 ${workflowCardClassName(isActive)}`}
          >
            <div className="flex items-start gap-2">
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => onSelectWorkflow(workflow.id)}
                type="button"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isActive ? "bg-[#171b20]" : "bg-[#b7bec8]"
                    }`}
                  />
                  <div className="truncate text-sm font-medium text-ink">{workflow.name}</div>
                </div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-slate/58">
                  {workflow.file_name}
                </div>
              </button>

              <WorkflowCardMenu
                disabled={isBusy}
                onDelete={() => onDeleteWorkflow(workflow.id)}
                onDuplicate={() => onDuplicateWorkflow(workflow.id)}
                onRename={() => onRenameWorkflow(workflow.id)}
              />
            </div>
          </article>
        );
      })}

      {invalidFiles.length > 0 ? (
        <div className="mt-3 rounded-[10px] border border-ember/20 bg-[#fff0eb] p-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ember">
            Needs attention
          </div>
          <div className="mt-2 space-y-2">
            {invalidFiles.map((file) => (
              <div key={file.id} className="rounded-[10px] border border-ember/15 bg-white p-3">
                <div className="text-sm font-semibold text-ink">{file.file_name}</div>
                <div className="mt-1 text-sm leading-6 text-slate">{file.error}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function workflowCardClassName(isActive: boolean) {
  return isActive
    ? "rounded-[12px] border-[#d6d0ff] bg-[#f7f5ff]"
    : "rounded-[12px] border-black/10 bg-white hover:border-black/18 hover:bg-[#fafafb]";
}

function WorkflowCardMenu({
  disabled,
  onDelete,
  onDuplicate,
  onRename
}: {
  disabled: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onRename: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-[10px] border border-black/10 bg-white text-slate/68 transition hover:border-black/20 hover:bg-[#f7f7fb] [&::-webkit-details-marker]:hidden"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span className="sr-only">Workflow actions</span>
        <ThreeDotsVerticalIcon />
      </button>

      {isOpen ? (
        <div className="absolute right-0 top-[calc(100%+0.35rem)] z-20 min-w-[148px] rounded-[10px] border border-black/10 bg-white p-1 shadow-[0_2px_8px_rgba(16,20,20,0.08)]">
          <button
            className="flex w-full items-center rounded-[8px] px-2.5 py-2 text-left text-sm text-ink transition hover:bg-[#f7f7fb] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={() => {
              setIsOpen(false);
              onRename();
            }}
            type="button"
          >
            Rename
          </button>
          <button
            className="flex w-full items-center rounded-[8px] px-2.5 py-2 text-left text-sm text-ink transition hover:bg-[#f7f7fb] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={() => {
              setIsOpen(false);
              onDuplicate();
            }}
            type="button"
          >
            Duplicate
          </button>
          <button
            className="flex w-full items-center rounded-[8px] px-2.5 py-2 text-left text-sm text-ember transition hover:bg-ember/10 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={() => {
              setIsOpen(false);
              onDelete();
            }}
            type="button"
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ThreeDotsVerticalIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="8" cy="3" fill="currentColor" r="1.1" />
      <circle cx="8" cy="8" fill="currentColor" r="1.1" />
      <circle cx="8" cy="13" fill="currentColor" r="1.1" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3.5 4.5H12.5M6 2.75H10M5 4.5V11.25C5 11.9404 5.55964 12.5 6.25 12.5H9.75C10.4404 12.5 11 11.9404 11 11.25V4.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
    </svg>
  );
}

function WorkflowYamlCard({
  fullHeight = false,
  workflowYaml
}: {
  fullHeight?: boolean;
  workflowYaml: string;
}) {
  return (
    <div
      className={`h-full border-black/10 bg-white ${
        fullHeight ? "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-black/10 px-3 py-2">
        <ShellBadge label="canonical" tone="info-dark" />
        <ShellBadge label="monospace" tone="neutral-dark" />
      </div>
      <pre
        className={`sleek-scroll bg-[#f6f7fa] px-4 py-4 font-mono text-[12px] leading-6 text-[#273140] ${
          fullHeight ? "min-h-0 overflow-auto border-t border-black/10" : "overflow-x-auto border border-black/10"
        }`}
      >
        {workflowYaml || "# No workflow selected"}
      </pre>
    </div>
  );
}

function decorateNodesForSelectedRun(
  nodes: CanvasNode[],
  activeWorkflow: WorkflowDocument | null,
  runDetail: RunDetailResponse | null
) {
  if (
    !activeWorkflow ||
    !runDetail ||
    runDetail.run.workflow_name !== activeWorkflow.workflow.name
  ) {
    return nodes.map((node) => ({
      ...node,
      type: "workflowNode",
      data: {
        ...node.data,
        executionLabel: null,
        executionMeta: null,
        executionState: "idle" as const
      }
    }));
  }

  const latestStepRuns = new Map<string, RunDetailResponse["step_runs"][number]>();
  for (const stepRun of runDetail.step_runs) {
    const current = latestStepRuns.get(stepRun.step_id);
    if (!current || stepRun.attempt > current.attempt) {
      latestStepRuns.set(stepRun.step_id, stepRun);
    } else if (stepRun.attempt === current.attempt && (stepRun.started_at ?? "") > (current.started_at ?? "")) {
      latestStepRuns.set(stepRun.step_id, stepRun);
    }
  }

  const pendingTaskStepIds = new Set(
    runDetail.human_tasks
      .filter((task) => task.status === "pending")
      .map((task) => task.step_id)
  );

  return nodes.map((node) => {
    if (node.id === TRIGGER_NODE_ID) {
      const runState = normalizeExecutionState(runDetail.run.status);
      return {
        ...node,
        type: "workflowNode",
        data: {
          ...node.data,
          executionLabel: executionLabel(runState),
          executionMeta: runDetail.run.id.slice(0, 8),
          executionState: runState
        }
      };
    }

    const latestStepRun = latestStepRuns.get(node.id);
    let state: NodeExecutionState = "idle";
    if (pendingTaskStepIds.has(node.id)) {
      state = "paused";
    } else if (latestStepRun) {
      state = normalizeExecutionState(latestStepRun.status);
    }

    return {
      ...node,
      type: "workflowNode",
      data: {
        ...node.data,
        executionLabel: executionLabel(state),
        executionMeta: latestStepRun ? executionMeta(state, latestStepRun) : null,
        executionState: state
      }
    };
  });
}

function finalizeDocument(document: WorkflowDocument): WorkflowDocument {
  const allowedPositionKeys = new Set([
    TRIGGER_NODE_ID,
    ...document.workflow.steps.map((step) => step.id)
  ]);
  const positions = Object.fromEntries(
    Object.entries(document.positions).filter(([key]) => allowedPositionKeys.has(key))
  );
  const workflow = {
    ...document.workflow,
    ui: {
      ...(document.workflow.ui ?? {}),
      positions
    }
  };

  return {
    ...document,
    dirty: true,
    localDraft: document.localDraft,
    positions,
    summary: summarizeWorkflow(document.id, workflow, {
      localDraft: document.localDraft
    }),
    workflow,
    yaml: workflowToYaml(workflow)
  };
}

function renamePositionKey(
  positions: Record<string, { x: number; y: number }>,
  from: string,
  to: string
) {
  if (!(from in positions)) {
    return positions;
  }
  const nextPositions = { ...positions };
  nextPositions[to] = nextPositions[from];
  delete nextPositions[from];
  return nextPositions;
}

function omitPosition(
  positions: Record<string, { x: number; y: number }>,
  key: string
) {
  const nextPositions = { ...positions };
  delete nextPositions[key];
  return nextPositions;
}

function upsertWorkflowSummary(
  workflows: WorkflowSummary[],
  summary: WorkflowSummary
) {
  const existingIndex = workflows.findIndex((workflow) => workflow.id === summary.id);
  if (existingIndex === -1) {
    return [...workflows, summary].sort((left, right) =>
      left.file_name.localeCompare(right.file_name)
    );
  }
  const nextWorkflows = [...workflows];
  nextWorkflows[existingIndex] = summary;
  return nextWorkflows;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
}

function persistDocumentLayout(document: WorkflowDocument) {
  if (!document.localDraft) {
    persistWorkflowPositions(document.id, document.positions);
  }
  return document;
}

function mergeWorkflowSummaries(
  documents: Record<string, WorkflowDocument>,
  persistedWorkflows: WorkflowSummary[]
) {
  const workflowMap = new Map(
    persistedWorkflows.map((workflow) => [workflow.id, { ...workflow }])
  );

  for (const document of Object.values(documents)) {
    if (!document.localDraft) {
      continue;
    }
    workflowMap.set(document.id, document.summary);
  }

  return Array.from(workflowMap.values()).sort((left, right) =>
    left.file_name.localeCompare(right.file_name)
  );
}

function nextDraftWorkflowId(workflows: WorkflowSummary[]) {
  const existingIds = new Set(workflows.map((workflow) => workflow.id));
  let index = 1;
  while (existingIds.has(`untitled-workflow-${index}`)) {
    index += 1;
  }
  return `untitled-workflow-${index}`;
}

function nextSelectableWorkflowId(
  workflows: WorkflowSummary[],
  preferredWorkflowId: string | null
) {
  return (
    workflows.find((workflow) => workflow.id === preferredWorkflowId)?.id ??
    workflows[0]?.id ??
    null
  );
}

function saveDisabledMessage(activeWorkflow: WorkflowDocument | null) {
  if (!activeWorkflow) {
    return "Select a workflow before saving.";
  }
  if (!workflowHasRunnableSteps(activeWorkflow.workflow)) {
    return "Add at least one step before saving this workflow.";
  }
  return null;
}

function runDisabledMessage(activeWorkflow: WorkflowDocument | null) {
  if (!activeWorkflow) {
    return "Select a workflow before running it.";
  }
  if (!workflowHasRunnableSteps(activeWorkflow.workflow)) {
    return "Add at least one step before saving or running this workflow.";
  }
  if (activeWorkflow.localDraft) {
    return "Save this draft before running it.";
  }
  return null;
}

function workflowDraftNotice(activeWorkflow: WorkflowDocument | null) {
  if (!activeWorkflow) {
    return null;
  }
  if (!workflowHasRunnableSteps(activeWorkflow.workflow)) {
    return "Add the first step to this workflow. Save and Run stay disabled until the canvas has at least one step.";
  }
  if (activeWorkflow.localDraft) {
    return `Save this draft to create ${activeWorkflow.summary.file_name} and enable runs.`;
  }
  return null;
}

function readStoredWorkflowPositions(workflowId: string) {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    const stored = window.localStorage.getItem(workflowLayoutStorageKey(workflowId));
    if (!stored) {
      return undefined;
    }
    const parsed = JSON.parse(stored) as Record<string, { x: unknown; y: unknown }>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([nodeId, position]) => {
        const x = Number(position?.x);
        const y = Number(position?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return [];
        }
        return [[nodeId, { x, y }]];
      })
    );
  } catch {
    return undefined;
  }
}

function persistWorkflowPositions(
  workflowId: string,
  positions: Record<string, { x: number; y: number }>
) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(workflowLayoutStorageKey(workflowId), JSON.stringify(positions));
  } catch {
    // Ignore storage quota or privacy-mode errors.
  }
}

function clearStoredWorkflowPositions(workflowId: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(workflowLayoutStorageKey(workflowId));
  } catch {
    // Ignore storage failures.
  }
}

function workflowLayoutStorageKey(workflowId: string) {
  return `acsa:workflow-layout:${workflowId}`;
}

function normalizeExecutionState(status: string): NodeExecutionState {
  switch (status) {
    case "failed":
      return "failed";
    case "paused":
      return "paused";
    case "running":
      return "running";
    case "skipped":
      return "skipped";
    case "success":
      return "success";
    default:
      return "idle";
  }
}

function executionLabel(state: NodeExecutionState) {
  switch (state) {
    case "failed":
      return "Failed";
    case "paused":
      return "Action required";
    case "running":
      return "Running";
    case "skipped":
      return "Skipped";
    case "success":
      return "Success";
    default:
      return null;
  }
}

function executionMeta(
  state: NodeExecutionState,
  stepRun: RunDetailResponse["step_runs"][number]
) {
  if (state === "paused") {
    return `attempt ${stepRun.attempt}`;
  }
  if (state === "running") {
    return `attempt ${stepRun.attempt}`;
  }
  if (stepRun.duration_seconds !== null && stepRun.duration_seconds !== undefined) {
    return formatDuration(stepRun.duration_seconds);
  }
  return `attempt ${stepRun.attempt}`;
}
