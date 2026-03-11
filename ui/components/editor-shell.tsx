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

import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  type Edge,
  type XYPosition
} from "@xyflow/react";

import { HumanTaskInbox } from "./human-task-inbox";
import { NodeInspector } from "./node-inspector";
import { RunHistoryPanel } from "./run-history-panel";
import { TopBar } from "./top-bar";
import { ConnectorManager } from "./connector-manager";
import { WorkflowCanvas } from "./workflow-canvas";
import { WorkflowExplorer } from "./workflow-explorer";
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
  type PendingTask,
  type StepTypeEntry,
  type TriggerTypeEntry,
  TRIGGER_NODE_ID,
  type WorkflowDefinition,
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
    lastAction,
    lastRun,
    newStepType,
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
      lastAction: state.lastAction,
      lastRun: state.lastRun,
      newStepType: state.newStepType,
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
    runWorkflowFilter,
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
      runWorkflowFilter: state.runWorkflowFilter,
      selectedRunId: state.selectedRunId
    }))
  );
  const { clearTaskValue, patch: patchWorkflowState, setDocuments, setTaskValue, setWorkflows } =
    useWorkflowActions();
  const { patch: patchObservabilityState } = useObservabilityActions();

  const activeWorkflow = activeWorkflowId ? documents[activeWorkflowId] ?? null : null;
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
    if (isBooting) {
      return;
    }
    void refreshRunHistory(selectedRunId);
  }, [runStatusFilter, runWorkflowFilter, selectedRunId]);

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
      if (preferredWorkflowId) {
        await loadWorkflowDocument(preferredWorkflowId);
      }
      await refreshRunHistory();
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
    } catch (error) {
      patchWorkflowState({
        globalError: errorMessage(error),
        lastAction: `Failed to load ${workflowId}.yaml`
      });
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

  async function refreshNodeCatalog() {
    try {
      const catalog = await fetchEngineJson<NodeCatalogResponse>("/api/node-catalog");
      patchWorkflowState({
        stepCatalog: catalog.step_types,
        triggerCatalog: catalog.trigger_types
      });
    } catch (error) {
      patchWorkflowState({ globalError: errorMessage(error) });
    }
  }

  async function refreshRunHistory(preferredRunId?: string | null) {
    const currentObservabilityState = observabilityStoreState();
    patchObservabilityState({ isRefreshingHistory: true });
    try {
      const query = new URLSearchParams();
      if (currentObservabilityState.runWorkflowFilter.trim()) {
        query.set("workflow_name", currentObservabilityState.runWorkflowFilter.trim());
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
      if (nextWorkflowId) {
        await loadWorkflowDocument(nextWorkflowId);
      }
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

  function handleAddStep() {
    if (!activeWorkflow) {
      return;
    }
    const { selectedNodeId: createdNodeId, workflow } = addStepToWorkflow(
      activeWorkflow.workflow,
      newStepType
    );
    applyActiveWorkflowUpdate((document) => ({
      ...document,
      workflow
    }));
    patchWorkflowState({
      lastAction: `Added ${newStepType} step`,
      selectedNodeId: createdNodeId
    });
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
      await refreshRunHistory(selectedRunId);
      const workflowIdToLoad = nextWorkflowId ?? activeWorkflowId;
      if (workflowIdToLoad) {
        await loadWorkflowDocument(workflowIdToLoad);
      }
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
      await loadWorkflowDocument(workflowId);
      return;
    }
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
      workflow: removeStepFromWorkflow(document.workflow, targetStepId)
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

  return (
    <main className="min-h-screen px-5 py-6 text-ink lg:px-8">
      <div className="mx-auto flex max-w-[1700px] flex-col gap-5">
        <TopBar
          activeWorkflowFile={activeWorkflow?.summary.file_name ?? "No workflow selected"}
          activeWorkflowName={activeWorkflow?.workflow.name ?? "No workflow"}
          isRunning={isRunning}
          isSaving={isSaving}
          lastAction={lastAction}
          onRefresh={() => void handleRefresh()}
          onRun={() => void handleRun()}
          onSave={() => void handleSave()}
          pendingTaskCount={pendingTasks.length}
          runStatus={
            runStatus ??
            (lastRun
              ? `${lastRun.status} • ${lastRun.run_id.slice(0, 8)}`
              : null)
          }
        />

        {globalError ? (
          <section className="rounded-3xl border border-ember/20 bg-ember/5 px-5 py-4 text-sm leading-6 text-ember">
            {globalError}
          </section>
        ) : null}

        <section className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)_400px]">
          <div className="flex min-h-0 flex-col gap-5">
            <WorkflowExplorer
              activeWorkflowId={activeWorkflowId}
              invalidFiles={invalidFiles}
              isBusy={isBusy}
              onCreateWorkflow={() => void handleCreateWorkflow()}
              onDeleteWorkflow={(workflowId) => void handleDeleteWorkflow(workflowId)}
              onDuplicateWorkflow={(workflowId) => void handleDuplicateWorkflow(workflowId)}
              onSelectWorkflow={(workflowId) => void handleSelectWorkflow(workflowId)}
              workflows={workflows}
            />

            <ConnectorManager onCatalogInvalidated={() => refreshNodeCatalog()} />
          </div>

          <div className="panel-surface min-h-[760px] overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-black/10 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="section-kicker">Canvas</p>
                <h2 className="section-title">
                  {activeWorkflow?.workflow.name ?? "Untitled workflow"}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  className="ui-input w-auto min-w-[220px]"
                  onChange={(event) =>
                    patchWorkflowState({ newStepType: event.target.value })
                  }
                  value={newStepType}
                >
                  {groupedOptions(stepCatalog).map(([category, entries]) => (
                    <optgroup key={category} label={titleCase(category)}>
                      {entries.map((entry) => (
                        <option key={entry.type_name} value={entry.type_name}>
                          {entry.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  className="ui-button ui-button-tide"
                  onClick={handleAddStep}
                  type="button"
                >
                  Add step
                </button>
                <button
                  className="ui-button"
                  onClick={handleAutoLayout}
                  type="button"
                >
                  Auto layout
                </button>
                <div className="rounded-md border border-ember/20 bg-ember/10 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ember">
                  YAML remains the source of truth
                </div>
              </div>
            </div>

            <div className="h-[680px]">
              {activeWorkflow ? (
                <WorkflowCanvas
                  key={activeWorkflow.id}
                  edges={canvas.edges}
                  nodes={displayNodes}
                  onDeleteStep={handleDeleteSelectedNode}
                  onEdgesCommit={handleEdgesCommit}
                  onPositionsCommit={handlePositionsCommit}
                  onSelectNode={(nodeId) => patchWorkflowState({ selectedNodeId: nodeId })}
                />
              ) : (
                <div className="flex h-full items-center justify-center px-10 text-center text-sm leading-7 text-slate">
                  {isBooting
                    ? "Booting the editor..."
                    : "No valid workflow is loaded yet. Create a new workflow or fix invalid YAML files from the explorer."}
                </div>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-5">
            <NodeInspector
              activeWorkflow={activeWorkflow}
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
              stepCatalog={stepCatalog}
              stepParamsDraft={stepParamsDraft}
              triggerCatalog={triggerCatalog}
              triggerDetailsDraft={triggerDetailsDraft}
              workflowYaml={activeWorkflow?.yaml ?? ""}
            />

            <HumanTaskInbox
              isRefreshing={isRefreshingTasks}
              onApprove={(taskId, approved) => void handleApprovalTask(taskId, approved)}
              onRefresh={() => void refreshHumanTasks()}
              onResolveValue={(taskId) => void handleManualInputTask(taskId)}
              onValueChange={handleTaskValueChange}
              taskValues={taskValues}
              tasks={pendingTasks}
            />
          </div>
        </section>

        <RunHistoryPanel
          isLoading={isRefreshingHistory}
          logLevelFilter={logLevelFilter}
          logSearch={logSearch}
          logs={runLogs}
          metrics={metrics}
          onLogLevelFilterChange={(value) => patchObservabilityState({ logLevelFilter: value })}
          onLogSearchChange={(value) => patchObservabilityState({ logSearch: value })}
          onRefresh={() => void refreshRunHistory(selectedRunId)}
          onRunStatusFilterChange={(value) => patchObservabilityState({ runStatusFilter: value })}
          onRunWorkflowFilterChange={(value) =>
            patchObservabilityState({ runWorkflowFilter: value })
          }
          onSelectRun={(runId) => patchObservabilityState({ selectedRunId: runId })}
          runDetail={runDetail}
          runPage={runPage}
          runStatusFilter={runStatusFilter}
          runWorkflowFilter={runWorkflowFilter}
          selectedRunId={selectedRunId}
        />
      </div>
    </main>
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
