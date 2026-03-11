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

import { HumanTaskInbox } from "./human-task-inbox";
import { NodeInspector } from "./node-inspector";
import { RunHistoryPanel } from "./run-history-panel";
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
  addStepToWorkflow,
  autoLayoutWorkflow,
  createBlankWorkflow,
  defaultStepParamsForType,
  defaultTriggerDetailsForType,
  extractTriggerDetails,
  formatYaml,
  parseObjectYaml,
  RunSummary,
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
  workflowDocumentFromResponse,
  workflowToCanvas,
  workflowToYaml,
  updateWorkflowEdges,
  removeStepFromWorkflow,
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
    lastRun,
    pendingTasks,
    runStatus,
    selectedNodeId,
    stepCatalog,
    stepParamsDraft,
    taskValues,
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
      lastRun: state.lastRun,
      pendingTasks: state.pendingTasks,
      runStatus: state.runStatus,
      selectedNodeId: state.selectedNodeId,
      stepCatalog: state.stepCatalog,
      stepParamsDraft: state.stepParamsDraft,
      taskValues: state.taskValues,
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
  const { clearTaskValue, patch: patchWorkflowState, setDocuments, setTaskValue, setWorkflows } =
    useWorkflowActions();
  const { patch: patchObservabilityState } = useObservabilityActions();

  const activeWorkflow = activeWorkflowId ? documents[activeWorkflowId] ?? null : null;
  const [centerView, setCenterView] = useState<WorkspaceView>("canvas");
  const [frameRequestKey, setFrameRequestKey] = useState(0);
  const [isAddStepMenuOpen, setIsAddStepMenuOpen] = useState(false);
  const addStepMenuRef = useRef<HTMLDivElement | null>(null);
  const canvas = useMemo(
    () =>
      activeWorkflow
        ? workflowToCanvas(activeWorkflow.workflow, activeWorkflow.positions, stepCatalog)
        : { edges: [] as Edge[], nodes: [] as CanvasNode[], positions: {} },
    [activeWorkflow, stepCatalog]
  );
  const displayNodes = useMemo(
    () => decorateNodesForSelectedRun(canvas.nodes, activeWorkflow, runDetail),
    [activeWorkflow, canvas.nodes, runDetail]
  );
  const selectedNode =
    selectedNodeId === null
      ? null
      : displayNodes.find((node) => node.id === selectedNodeId) ?? null;
  const isBusy =
    isBooting ||
    isLoadingWorkflow ||
    isRefreshingHistory ||
    isRefreshingTasks ||
    isRunning ||
    isSaving;

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!isAddStepMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!addStepMenuRef.current?.contains(event.target as Node)) {
        setIsAddStepMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsAddStepMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAddStepMenuOpen]);

  useEffect(() => {
    if (isBooting) {
      return;
    }
    void refreshRunHistory(selectedRunId);
  }, [isBooting, runStatusFilter, selectedRunId]);

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
        workflows: inventory.workflows
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
      patchWorkflowState({
        lastAction: `Opened ${response.summary.file_name}`,
        selectedNodeId: TRIGGER_NODE_ID
      });
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
    patchWorkflowState({
      invalidFiles: inventory.invalid_files,
      workflows: inventory.workflows
    });
    const nextWorkflowId =
      inventory.workflows.find((workflow) => workflow.id === preferredWorkflowId)?.id ??
      inventory.workflows[0]?.id ??
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
        pageResponse.runs.find((run) => run.id === preferredRunId)?.id ??
        pageResponse.runs.find(
          (run) => run.id === currentObservabilityState.selectedRunId
        )?.id ??
        pageResponse.runs[0]?.id ??
        null;
      patchObservabilityState({
        isRefreshingHistory: false,
        logs: nextRunId ? currentObservabilityState.logs : null,
        metrics: parseMetricsSummary(metricsText),
        runDetail: nextRunId ? currentObservabilityState.runDetail : null,
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
    } catch (error) {
      patchWorkflowState({ globalError: errorMessage(error) });
    }
  }

  function applyActiveWorkflowUpdate(
    updater: (document: WorkflowDocument) => WorkflowDocument
  ) {
    if (!activeWorkflow) {
      return;
    }
    const nextDocument = finalizeDocument(updater(activeWorkflow));
    persistWorkflowPositions(nextDocument.id, nextDocument.positions);
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
    const proposedId = window.prompt(
      "Workflow file id",
      `workflow-${workflows.length + 1}`
    );
    if (!proposedId) {
      return;
    }
    const workflowId = slugifyIdentifier(proposedId);
    const yaml = workflowToYaml(createBlankWorkflow(workflowId));

    try {
      const response = await fetchEngineJson<WorkflowDocumentResponse>("/api/workflows", {
        body: JSON.stringify({ id: workflowId, yaml }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
      applyWorkflowResponse(response);
      patchWorkflowState({
        activeWorkflowId: response.id,
        globalError: null,
        lastAction: `Created ${response.summary.file_name}`,
        selectedNodeId: TRIGGER_NODE_ID
      });
      await refreshInventory(response.id);
      await refreshRunHistory(undefined, response.summary.name);
    } catch (error) {
      patchWorkflowState({
        globalError: errorMessage(error),
        lastAction: "Failed to create workflow"
      });
    }
  }

  async function handleDeleteWorkflow(workflowId: string) {
    if (!window.confirm(`Delete ${workflowId}.yaml?`)) {
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
        const response = await loadWorkflowDocument(nextWorkflowId);
        workflowName = response?.summary.name ?? null;
      }
      await refreshRunHistory(undefined, workflowName);
      patchWorkflowState({
        globalError: null,
        lastAction: `Deleted ${workflowId}.yaml`
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
        selectedNodeId: TRIGGER_NODE_ID
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

  function handleAddStep(typeName: string) {
    if (!activeWorkflow) {
      return;
    }
    const { selectedNodeId: createdNodeId, workflow } = addStepToWorkflow(
      activeWorkflow.workflow,
      typeName
    );
    applyActiveWorkflowUpdate((document) => ({
      ...document,
      workflow
    }));
    patchWorkflowState({
      lastAction: `Added ${typeName.replace(/_/g, " ")} step`,
      selectedNodeId: createdNodeId
    });
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
        const response = await loadWorkflowDocument(workflowIdToLoad);
        workflowName = response?.summary.name ?? workflowName;
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
    patchWorkflowState({ isRunning: true });
    try {
      const response = await fetchEngineJson<RunSummary>(
        `/api/workflows/${activeWorkflow.id}/run`,
        {
          body: JSON.stringify({ payload: {} }),
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        }
      );
      patchWorkflowState({
        lastRun: response,
        runStatus: `${response.status} • ${response.run_id.slice(0, 8)}`
      });
      await refreshHumanTasks();
      await refreshRunHistory(response.run_id);
      patchWorkflowState({
        globalError: null,
        lastAction:
          response.status === "paused"
            ? `Run paused with ${response.pending_tasks.length} pending task(s)`
            : `Run completed successfully (${response.completed_steps} steps)`
      });
    } catch (error) {
      patchWorkflowState({
        globalError: errorMessage(error),
        lastAction: "Workflow run failed"
      });
    } finally {
      patchWorkflowState({ isRunning: false });
    }
  }

  async function handleSave() {
    if (!activeWorkflow) {
      return;
    }
    patchWorkflowState({ isSaving: true });
    try {
      const response = await fetchEngineJson<WorkflowDocumentResponse>(
        `/api/workflows/${activeWorkflow.id}`,
        {
          body: JSON.stringify({ yaml: activeWorkflow.yaml }),
          headers: {
            "content-type": "application/json"
          },
          method: "PUT"
        }
      );
      applyWorkflowResponse(response);
      patchWorkflowState({
        globalError: null,
        lastAction: `Saved ${response.summary.file_name}`
      });
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
      selectedNodeId: TRIGGER_NODE_ID
    });
    if (!documents[workflowId]) {
      const response = await loadWorkflowDocument(workflowId);
      await refreshRunHistory(selectedRunId, response?.summary.name ?? workflowId);
      return;
    }
    await refreshRunHistory(selectedRunId, documents[workflowId].workflow.name);
    patchWorkflowState({ lastAction: `Opened ${workflowId}.yaml` });
  }

  function handleWorkflowNameChange(name: string) {
    applyActiveWorkflowUpdate((document) => ({
      ...document,
      workflow: {
        ...document.workflow,
        name
      }
    }));
    patchWorkflowState({ lastAction: "Updated workflow name" });
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
    if (activeWorkflow.workflow.steps.length === 1) {
      patchWorkflowState({ inspectorError: "Workflows must keep at least one step." });
      return;
    }

    applyActiveWorkflowUpdate((document) => ({
      ...document,
      positions: omitPosition(document.positions, targetStepId),
      workflow: {
        ...removeStepFromWorkflow(document.workflow, targetStepId),
        ...(document.workflow.ui?.detached_steps?.includes(targetStepId)
          ? {
              ui: {
                ...document.workflow.ui,
                detached_steps: (document.workflow.ui?.detached_steps ?? []).filter(
                  (stepId) => stepId !== targetStepId
                )
              }
            }
          : {})
      }
    }));
    patchWorkflowState({
      inspectorError: null,
      lastAction: `Removed step ${targetStepId}`,
      selectedNodeId: TRIGGER_NODE_ID
    });
  }

  function handleTaskValueChange(taskId: string, value: string) {
    setTaskValue(taskId, value);
  }

  async function handleApprovalTask(taskId: string, approved: boolean) {
    await resolveTask(taskId, { approved });
  }

  async function handleManualInputTask(taskId: string) {
    const value = taskValues[taskId] ?? "";
    if (!value.trim()) {
      patchWorkflowState({
        globalError: "Manual input tasks require a value before resuming the run."
      });
      return;
    }
    await resolveTask(taskId, { value });
    clearTaskValue(taskId);
  }

  async function resolveTask(taskId: string, payload: Record<string, unknown>) {
    patchWorkflowState({ isRefreshingTasks: true });
    try {
      const response = await fetchEngineJson<RunSummary>(
        `/human-tasks/${taskId}/resolve`,
        {
          body: JSON.stringify(payload),
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        }
      );
      patchWorkflowState({
        lastRun: response,
        runStatus: `${response.status} • ${response.run_id.slice(0, 8)}`
      });
      await refreshHumanTasks();
      await refreshRunHistory(response.run_id);
      patchWorkflowState({
        globalError: null,
        lastAction:
          response.status === "paused"
            ? `Resolved task ${taskId} and the run paused again`
            : `Resolved task ${taskId} and resumed the run`
      });
    } catch (error) {
      patchWorkflowState({
        globalError: errorMessage(error),
        lastAction: `Failed to resolve task ${taskId}`
      });
    } finally {
      patchWorkflowState({ isRefreshingTasks: false });
    }
  }

  const showCanvasView = centerView === "canvas";
  const activeRunStatus =
    runStatus ??
    (lastRun ? `${lastRun.status} • ${lastRun.run_id.slice(0, 8)}` : null);
  const centerViewLabel =
    centerView === "canvas"
      ? "Canvas"
      : centerView === "preview"
        ? "Preview"
        : centerView === "history"
          ? "History"
          : "Logs";

  return (
    <main className="h-[100dvh] overflow-hidden bg-[#edf2f1] p-4 text-ink">
      <div
        className={`mx-auto grid h-full max-w-[1880px] gap-4 ${
          globalError ? "grid-rows-[58px_auto_minmax(0,1fr)]" : "grid-rows-[58px_minmax(0,1fr)]"
        }`}
      >
        <TopBar
          activeWorkflowFile={activeWorkflow?.summary.file_name ?? "No workflow selected"}
          activeWorkflowName={activeWorkflow?.workflow.name ?? "No workflow"}
          hasUnsavedChanges={activeWorkflow?.dirty ?? false}
          isRunning={isRunning}
          isSaving={isSaving}
          onRefresh={() => void handleRefresh()}
          onRun={() => void handleRun()}
          onSave={() => void handleSave()}
          runStatus={activeRunStatus}
        />

        {globalError ? (
          <section className="rounded-2xl border border-ember/20 bg-ember/5 px-4 py-3 text-sm leading-6 text-ember">
            {globalError}
          </section>
        ) : null}

        <section
          className={`grid min-h-0 gap-4 ${
            showCanvasView
              ? "xl:grid-cols-[256px_minmax(0,1fr)_336px]"
              : "xl:grid-cols-[256px_minmax(0,1fr)]"
          }`}
        >
          <aside className="panel-surface grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
            <div className="border-b border-black/10 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate/55">
                Navigation
              </div>
              <div className="mt-1 text-lg font-semibold tracking-tight text-ink">
                Workspace
              </div>
            </div>

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
                  onSelectWorkflow={(workflowId) => void handleSelectWorkflow(workflowId)}
                  workflows={workflows}
                />
              </SidebarBlock>

              <div className="mt-auto pt-8">
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

          <section className="panel-surface grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
            <div className="flex items-center justify-between border-b border-black/10 px-4 py-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate/55">
                  Center workspace
                </div>
                <div className="mt-1 text-lg font-semibold tracking-tight text-ink">
                  {centerViewLabel}
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-2xl border border-black/10 bg-white/80 p-1">
                {(["canvas", "preview", "history", "logs"] as WorkspaceView[]).map((view) => (
                  <button
                    key={view}
                    className={`rounded-xl px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] ${
                      centerView === view ? "bg-ink text-white" : "text-slate/68"
                    }`}
                    onClick={() => setCenterView(view)}
                    type="button"
                  >
                    {view}
                  </button>
                ))}
              </div>
            </div>

            {showCanvasView ? (
              <div className="relative h-full min-h-0">
                {activeWorkflow ? (
                  <>
                    <WorkflowCanvas
                      key={activeWorkflow.id}
                      edges={canvas.edges}
                      frameRequestKey={frameRequestKey}
                      nodes={displayNodes}
                      onAttachStepToTrigger={handleAttachStepToTrigger}
                      onDeleteStep={handleDeleteSelectedNode}
                      onEdgesCommit={handleEdgesCommit}
                      onPositionsCommit={handlePositionsCommit}
                      onSelectNode={(nodeId) => patchWorkflowState({ selectedNodeId: nodeId })}
                      showControls={false}
                      showMiniMap={false}
                      showViewportPanel={false}
                    />
                    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end p-4">
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
                    <div
                      className="absolute bottom-4 right-4 z-20"
                      ref={addStepMenuRef}
                    >
                      <button
                        aria-expanded={isAddStepMenuOpen}
                        aria-haspopup="menu"
                        aria-label="Add step"
                        className={`flex h-11 w-11 items-center justify-center rounded-2xl border text-xl text-white shadow-panel transition ${
                          isAddStepMenuOpen
                            ? "border-black/10 bg-slate"
                            : "border-black/10 bg-ink hover:bg-slate"
                        }`}
                        onClick={() => setIsAddStepMenuOpen((current) => !current)}
                        type="button"
                      >
                        +
                      </button>
                      {isAddStepMenuOpen ? (
                        <AddStepMenu
                          groupedStepCatalog={groupedOptions(stepCatalog)}
                          onSelectType={handleAddStep}
                        />
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center px-10 text-center text-sm leading-7 text-slate">
                    {isBooting
                      ? "Booting the editor..."
                      : "No valid workflow is loaded yet. Create a new workflow or fix invalid YAML files from the sidebar."}
                  </div>
                )}
              </div>
            ) : centerView === "preview" ? (
              <div className="min-h-0 p-4">
                <WorkflowYamlCard
                  fullHeight
                  workflowYaml={activeWorkflow?.yaml ?? ""}
                />
              </div>
            ) : (
              <RunHistoryPanel
                embedded
                isLoading={isRefreshingHistory}
                logLevelFilter={logLevelFilter}
                logSearch={logSearch}
                logs={runLogs}
                metrics={metrics}
                onLogLevelFilterChange={(value) => patchObservabilityState({ logLevelFilter: value })}
                onLogSearchChange={(value) => patchObservabilityState({ logSearch: value })}
                onRefresh={() => void refreshRunHistory(selectedRunId)}
                onRunStatusFilterChange={(value) => patchObservabilityState({ runStatusFilter: value })}
                onSelectRun={(runId) => patchObservabilityState({ selectedRunId: runId })}
                runDetail={runDetail}
                runPage={runPage}
                runStatusFilter={runStatusFilter}
                selectedRunId={selectedRunId}
                view={centerView === "logs" ? "logs" : "history"}
                workflowName={activeWorkflow?.workflow.name ?? null}
              />
            )}
          </section>

          {showCanvasView ? (
            <aside className="panel-surface grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
              <div className="border-b border-black/10 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate/55">
                      Context rail
                    </div>
                    <div className="mt-1 text-lg font-semibold tracking-tight text-ink">
                      Canvas details
                    </div>
                  </div>
                  <ShellBadge label="canvas only" tone="info" />
                </div>
              </div>

              <div className="sleek-scroll min-h-0 overflow-y-auto px-3 py-3">
                <AccordionCard
                  defaultOpen={pendingTasks.length > 0}
                  subtitle="Only shown when the workflow actually needs attention"
                  title="Required actions"
                  tone="warn"
                >
                  <HumanTaskInbox
                    embedded
                    isRefreshing={isRefreshingTasks}
                    onApprove={(taskId, approved) => void handleApprovalTask(taskId, approved)}
                    onRefresh={() => void refreshHumanTasks()}
                    onResolveValue={(taskId) => void handleManualInputTask(taskId)}
                    onValueChange={handleTaskValueChange}
                    taskValues={taskValues}
                    tasks={pendingTasks}
                  />
                </AccordionCard>

                <AccordionCard
                  defaultOpen
                  subtitle="Step metadata and settings stay compact until needed"
                  title="Inspector"
                  tone="neutral"
                >
                  <NodeInspector
                    activeWorkflow={activeWorkflow}
                    embedded
                    inspectorError={inspectorError}
                    onDeleteSelectedNode={() => handleDeleteSelectedNode()}
                    onSelectedNodeIdChange={handleSelectedNodeIdChange}
                    onSelectedNodeParamsChange={handleSelectedNodeParamsChange}
                    onSelectedNodeRetryAttemptsChange={handleSelectedNodeRetryAttemptsChange}
                    onSelectedNodeRetryBackoffChange={handleSelectedNodeRetryBackoffChange}
                    onSelectedNodeTimeoutChange={handleSelectedNodeTimeoutChange}
                    onSelectedNodeTypeChange={handleSelectedNodeTypeChange}
                    onTriggerDetailsChange={handleTriggerDetailsChange}
                    onTriggerTypeChange={handleTriggerTypeChange}
                    onWorkflowNameChange={handleWorkflowNameChange}
                    selectedNode={selectedNode}
                    showYamlPreview={false}
                    stepCatalog={stepCatalog}
                    stepParamsDraft={stepParamsDraft}
                    triggerCatalog={triggerCatalog}
                    triggerDetailsDraft={triggerDetailsDraft}
                    workflowYaml={activeWorkflow?.yaml ?? ""}
                  />
                </AccordionCard>
              </div>
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
    <section className="mb-4">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/55">
          {title}
        </div>
        {accessory}
      </div>
      {children}
    </section>
  );
}

function AccordionCard({
  children,
  defaultOpen,
  subtitle,
  title,
  tone
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  subtitle: string;
  title: string;
  tone: "dark" | "neutral" | "warn";
}) {
  const toneShell = {
    dark: "bg-white/80",
    neutral: "bg-white/80",
    warn: "bg-white/80"
  } as const;

  return (
    <details className={`mb-4 rounded-2xl border border-black/10 px-3 py-3 ${toneShell[tone]}`} open={defaultOpen}>
      <summary className="cursor-pointer list-none">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-ink">{title}</div>
            <div className="mt-1 text-xs leading-5 text-slate">{subtitle}</div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white/70 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-slate/62">
            ▾
          </div>
        </div>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function AddStepMenu({
  groupedStepCatalog,
  onSelectType
}: {
  groupedStepCatalog: [string, StepTypeEntry[]][];
  onSelectType: (typeName: string) => void;
}) {
  return (
    <div className="absolute bottom-[calc(100%+0.75rem)] right-0 z-30 w-[320px] rounded-2xl border border-black/10 bg-white p-2 shadow-panel">
      <div className="sleek-scroll max-h-[360px] space-y-3 overflow-y-auto pr-1">
        {groupedStepCatalog.map(([category, entries]) => (
          <section key={category}>
            <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate/55">
              {titleCase(category)}
            </div>
            <div className="space-y-1.5">
              {entries.map((entry) => (
                <button
                  key={entry.type_name}
                  className="group w-full rounded-xl border border-transparent bg-white px-3 py-2 text-left transition hover:border-black/10 hover:bg-black/[0.02]"
                  onClick={() => onSelectType(entry.type_name)}
                  title={entry.description}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-ink">{entry.label}</div>
                    {entry.runtime ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate/58">
                        {entry.runtime}
                      </span>
                    ) : null}
                  </div>
                  <div className="max-h-0 overflow-hidden text-xs leading-5 text-slate opacity-0 transition-all duration-150 group-hover:mt-1 group-hover:max-h-16 group-hover:opacity-100">
                    {entry.description}
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
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
    info: "border-tide/15 bg-tide/10 text-tide",
    "info-dark": "border-tide/10 bg-tide/15 text-[#8be2e6]",
    neutral: "border-black/10 bg-black/[0.04] text-slate/72",
    "neutral-dark": "border-white/10 bg-white/10 text-white/72",
    warn: "border-ember/15 bg-ember/10 text-ember"
  } as const;

  return (
    <span
      className={`rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${toneMap[tone]}`}
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
    <div className="rounded-2xl border border-black/10 bg-white/70 px-3 py-3">
      <div className="grid grid-cols-3 gap-2">
        <StatPill label="runs" value={String(metrics?.workflowRunsTotal ?? 0)} />
        <StatPill label="paused" value={String(metrics?.workflowRunsPaused ?? 0)} />
        <StatPill label="errors" value={String(invalidFileCount)} />
      </div>
      <div className="mt-3 rounded-xl border border-black/10 bg-black/[0.03] px-2.5 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate/55">
          Status
        </div>
        <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-ink">
          {activeRunStatus ? activeRunStatus.split(" • ")[0] : "idle"}
        </div>
      </div>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/10 bg-black/[0.03] px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate/55">
        {label}
      </div>
      <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-ink">
        {value}
      </div>
    </div>
  );
}

function WorkflowList({
  activeWorkflowId,
  invalidFiles,
  isBusy,
  onDeleteWorkflow,
  onDuplicateWorkflow,
  onSelectWorkflow,
  workflows
}: {
  activeWorkflowId: string | null;
  invalidFiles: InvalidWorkflowFile[];
  isBusy: boolean;
  onDeleteWorkflow: (workflowId: string) => void;
  onDuplicateWorkflow: (workflowId: string) => void;
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
            className={`rounded-2xl border px-3 py-3 ${
              isActive ? "border-tide/20 bg-tide/10" : "border-black/10 bg-white/70"
            }`}
          >
            <div className="flex items-start gap-2">
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => onSelectWorkflow(workflow.id)}
                type="button"
              >
                <div className="truncate text-sm font-semibold text-ink">{workflow.name}</div>
                <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-slate/58">
                  {workflow.file_name}
                </div>
              </button>

              <WorkflowCardMenu
                disabled={isBusy}
                onDelete={() => onDeleteWorkflow(workflow.id)}
                onDuplicate={() => onDuplicateWorkflow(workflow.id)}
              />
            </div>
          </article>
        );
      })}

      {invalidFiles.length > 0 ? (
        <div className="rounded-2xl border border-ember/20 bg-ember/5 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ember">
            Needs attention
          </div>
          <div className="mt-2 space-y-2">
            {invalidFiles.map((file) => (
              <div key={file.id} className="rounded-xl border border-ember/15 bg-white/80 p-3">
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

function WorkflowCardMenu({
  disabled,
  onDelete,
  onDuplicate
}: {
  disabled: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
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
        className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-lg border border-black/10 bg-black/[0.03] text-slate/68 transition hover:border-black/20 hover:bg-black/[0.06] [&::-webkit-details-marker]:hidden"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span className="sr-only">Workflow actions</span>
        <ThreeDotsVerticalIcon />
      </button>

      {isOpen ? (
        <div className="absolute right-0 top-[calc(100%+0.35rem)] z-20 min-w-[148px] rounded-lg border border-black/10 bg-white p-1 shadow-panel">
          <button
            className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-sm text-ink transition hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-60"
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
            className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-sm text-ember transition hover:bg-ember/5 disabled:cursor-not-allowed disabled:opacity-60"
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

function WorkflowYamlCard({
  fullHeight = false,
  workflowYaml
}: {
  fullHeight?: boolean;
  workflowYaml: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-black/10 bg-[#101517] p-3 ${
        fullHeight ? "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]" : ""
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <ShellBadge label="canonical" tone="info-dark" />
        <ShellBadge label="monospace" tone="neutral-dark" />
      </div>
      <pre
        className={`sleek-scroll rounded-xl border border-white/10 bg-black/20 p-3 font-mono text-[12px] leading-6 text-[#E9F8F3] ${
          fullHeight ? "min-h-0 overflow-auto" : "overflow-x-auto"
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
    positions,
    summary: summarizeWorkflow(document.id, document.workflow),
    workflow,
    yaml: workflowToYaml(workflow)
  };
}

function groupedOptions(stepCatalog: StepTypeEntry[]) {
  const groups = new Map<string, StepTypeEntry[]>();
  for (const entry of stepCatalog) {
    const bucket = groups.get(entry.category) ?? [];
    bucket.push(entry);
    groups.set(entry.category, bucket);
  }
  return Array.from(groups.entries());
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
  persistWorkflowPositions(document.id, document.positions);
  return document;
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

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
