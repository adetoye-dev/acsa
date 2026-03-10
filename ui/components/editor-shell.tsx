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
  addEdge,
  applyEdgeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange
} from "@xyflow/react";

import { HumanTaskInbox } from "./human-task-inbox";
import { NodeInspector } from "./node-inspector";
import { RunHistoryPanel } from "./run-history-panel";
import { TopBar } from "./top-bar";
import { WorkflowExplorer } from "./workflow-explorer";
import {
  parseMetricsSummary,
  type LogPageResponse,
  type MetricsSummary,
  type RunDetailResponse,
  type RunPageResponse
} from "../lib/observability";
import {
  addStepToWorkflow,
  createBlankWorkflow,
  defaultStepParamsForType,
  defaultTriggerDetailsForType,
  ENGINE_PROXY_BASE,
  extractTriggerDetails,
  formatYaml,
  parseObjectYaml,
  RunSummary,
  type CanvasNode,
  type HumanTask,
  type InvalidWorkflowFile,
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
  updateWorkflowPositions,
  removeStepFromWorkflow,
  slugifyIdentifier,
  summarizeWorkflow,
  withStepUpdated
} from "../lib/workflow-editor";

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
  const [documents, setDocuments] = useState<Record<string, WorkflowDocument>>({});
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [invalidFiles, setInvalidFiles] = useState<InvalidWorkflowFile[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [stepCatalog, setStepCatalog] = useState<StepTypeEntry[]>([]);
  const [triggerCatalog, setTriggerCatalog] = useState<TriggerTypeEntry[]>([]);
  const [pendingTasks, setPendingTasks] = useState<HumanTask[]>([]);
  const [taskValues, setTaskValues] = useState<Record<string, string>>({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(TRIGGER_NODE_ID);
  const [stepParamsDraft, setStepParamsDraft] = useState("{}");
  const [triggerDetailsDraft, setTriggerDetailsDraft] = useState("{}");
  const [newStepType, setNewStepType] = useState("noop");
  const [lastAction, setLastAction] = useState("Loading workflow inventory");
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [inspectorError, setInspectorError] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [isRefreshingHistory, setIsRefreshingHistory] = useState(false);
  const [isLoadingWorkflow, setIsLoadingWorkflow] = useState(false);
  const [isRefreshingTasks, setIsRefreshingTasks] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastRun, setLastRun] = useState<RunSummary | null>(null);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetailResponse | null>(null);
  const [runLogs, setRunLogs] = useState<LogPageResponse | null>(null);
  const [runPage, setRunPage] = useState<RunPageResponse | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runWorkflowFilter, setRunWorkflowFilter] = useState("");
  const [runStatusFilter, setRunStatusFilter] = useState("");
  const [logLevelFilter, setLogLevelFilter] = useState("");
  const [logSearch, setLogSearch] = useState("");

  const activeWorkflow = activeWorkflowId ? documents[activeWorkflowId] ?? null : null;
  const canvas = useMemo(
    () =>
      activeWorkflow
        ? workflowToCanvas(activeWorkflow.workflow, activeWorkflow.positions, stepCatalog)
        : { edges: [] as Edge[], nodes: [] as CanvasNode[], positions: {} },
    [activeWorkflow, stepCatalog]
  );
  const selectedNode =
    selectedNodeId === null
      ? null
      : canvas.nodes.find((node) => node.id === selectedNodeId) ?? null;
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
      setStepParamsDraft("{}");
      setTriggerDetailsDraft("{}");
      return;
    }

    setTriggerDetailsDraft(formatYaml(extractTriggerDetails(activeWorkflow.workflow.trigger)));
    if (selectedNode?.data.kind === "step") {
      const selectedStep = activeWorkflow.workflow.steps.find(
        (step) => step.id === selectedNode.id
      );
      setStepParamsDraft(formatYaml(selectedStep?.params ?? {}));
    } else {
      setStepParamsDraft("{}");
    }
    setInspectorError(null);
  }, [activeWorkflow, selectedNode?.data.kind, selectedNode?.id]);

  useEffect(() => {
    if (isBooting || !selectedRunId) {
      if (!selectedRunId) {
        setRunDetail(null);
        setRunLogs(null);
      }
      return;
    }
    void loadRunDetail(selectedRunId);
  }, [isBooting, logLevelFilter, logSearch, selectedRunId]);

  async function bootstrap() {
    setIsBooting(true);
    setGlobalError(null);
    try {
      const [catalog, inventory, tasks] = await Promise.all([
        fetchEngineJson<NodeCatalogResponse>("/api/node-catalog"),
        fetchEngineJson<WorkflowInventoryResponse>("/api/workflows"),
        fetchEngineJson<HumanTaskResponse>("/human-tasks")
      ]);

      setStepCatalog(catalog.step_types);
      setTriggerCatalog(catalog.trigger_types);
      setNewStepType(catalog.step_types[0]?.type_name ?? "noop");
      setPendingTasks(tasks.tasks);
      setWorkflows(inventory.workflows);
      setInvalidFiles(inventory.invalid_files);

      const preferredWorkflowId =
        inventory.workflows.find((workflow) => workflow.id === activeWorkflowId)?.id ??
        inventory.workflows[0]?.id ??
        null;
      setActiveWorkflowId(preferredWorkflowId);
      if (preferredWorkflowId) {
        await loadWorkflowDocument(preferredWorkflowId);
      }
      await refreshRunHistory();
      setLastAction("Loaded workflow inventory, node catalog, and pending tasks");
    } catch (error) {
      setGlobalError(errorMessage(error));
      setLastAction("Failed to reach the engine API");
    } finally {
      setIsBooting(false);
    }
  }

  async function loadWorkflowDocument(workflowId: string) {
    setIsLoadingWorkflow(true);
    try {
      const response = await fetchEngineJson<WorkflowDocumentResponse>(
        `/api/workflows/${workflowId}`
      );
      applyWorkflowResponse(response);
      setSelectedNodeId(TRIGGER_NODE_ID);
      setLastAction(`Opened ${response.summary.file_name}`);
    } catch (error) {
      setGlobalError(errorMessage(error));
      setLastAction(`Failed to load ${workflowId}.yaml`);
    } finally {
      setIsLoadingWorkflow(false);
    }
  }

  async function refreshHumanTasks() {
    setIsRefreshingTasks(true);
    try {
      const response = await fetchEngineJson<HumanTaskResponse>("/human-tasks");
      setPendingTasks(response.tasks);
    } catch (error) {
      setGlobalError(errorMessage(error));
    } finally {
      setIsRefreshingTasks(false);
    }
  }

  async function refreshInventory(preferredWorkflowId?: string | null) {
    const inventory = await fetchEngineJson<WorkflowInventoryResponse>("/api/workflows");
    setWorkflows(inventory.workflows);
    setInvalidFiles(inventory.invalid_files);
    const nextWorkflowId =
      inventory.workflows.find((workflow) => workflow.id === preferredWorkflowId)?.id ??
      inventory.workflows[0]?.id ??
      null;
    setActiveWorkflowId(nextWorkflowId);
    return nextWorkflowId;
  }

  async function refreshRunHistory(preferredRunId?: string | null) {
    setIsRefreshingHistory(true);
    try {
      const query = new URLSearchParams();
      if (runWorkflowFilter.trim()) {
        query.set("workflow_name", runWorkflowFilter.trim());
      }
      if (runStatusFilter.trim()) {
        query.set("status", runStatusFilter.trim());
      }
      query.set("page", "1");
      query.set("page_size", "12");

      const [pageResponse, metricsText] = await Promise.all([
        fetchEngineJson<RunPageResponse>(`/api/runs?${query.toString()}`),
        fetchEngineText("/metrics")
      ]);

      setRunPage(pageResponse);
      setMetrics(parseMetricsSummary(metricsText));
      const nextRunId =
        pageResponse.runs.find((run) => run.id === preferredRunId)?.id ??
        pageResponse.runs.find((run) => run.id === selectedRunId)?.id ??
        pageResponse.runs[0]?.id ??
        null;
      setSelectedRunId(nextRunId);
      if (!nextRunId) {
        setRunDetail(null);
        setRunLogs(null);
      }
    } catch (error) {
      setGlobalError(errorMessage(error));
    } finally {
      setIsRefreshingHistory(false);
    }
  }

  async function loadRunDetail(runId: string) {
    try {
      const [detailResponse, logResponse] = await Promise.all([
        fetchEngineJson<RunDetailResponse>(`/api/runs/${runId}`),
        fetchEngineJson<LogPageResponse>(
          `/api/runs/${runId}/logs?${new URLSearchParams({
            ...(logLevelFilter ? { level: logLevelFilter } : {}),
            ...(logSearch ? { search: logSearch } : {}),
            page: "1",
            page_size: "80"
          }).toString()}`
        )
      ]);
      setRunDetail(detailResponse);
      setRunLogs(logResponse);
    } catch (error) {
      setGlobalError(errorMessage(error));
    }
  }

  function applyActiveWorkflowUpdate(
    updater: (document: WorkflowDocument) => WorkflowDocument
  ) {
    if (!activeWorkflow) {
      return;
    }
    const nextDocument = finalizeDocument(updater(activeWorkflow));
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
      [response.id]: workflowDocumentFromResponse(response, current[response.id])
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
      setActiveWorkflowId(response.id);
      setSelectedNodeId(TRIGGER_NODE_ID);
      setLastAction(`Created ${response.summary.file_name}`);
      setGlobalError(null);
      await refreshInventory(response.id);
    } catch (error) {
      setGlobalError(errorMessage(error));
      setLastAction("Failed to create workflow");
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
      const nextWorkflowId = await refreshInventory(
        activeWorkflowId === workflowId ? null : activeWorkflowId
      );
      if (nextWorkflowId) {
        await loadWorkflowDocument(nextWorkflowId);
      }
      setLastAction(`Deleted ${workflowId}.yaml`);
      setGlobalError(null);
    } catch (error) {
      setGlobalError(errorMessage(error));
      setLastAction(`Failed to delete ${workflowId}.yaml`);
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
      setActiveWorkflowId(response.id);
      setSelectedNodeId(TRIGGER_NODE_ID);
      setLastAction(`Duplicated ${workflowId}.yaml to ${response.summary.file_name}`);
      setGlobalError(null);
      await refreshInventory(response.id);
    } catch (error) {
      setGlobalError(errorMessage(error));
      setLastAction("Workflow duplication failed");
    }
  }

  function handleNodesChange(changes: NodeChange<CanvasNode>[]) {
    if (!activeWorkflow) {
      return;
    }

    const removedStep = changes.find(
      (change): change is Extract<NodeChange<CanvasNode>, { id: string; type: "remove" }> =>
        change.type === "remove" && "id" in change && change.id !== TRIGGER_NODE_ID
    );
    if (removedStep) {
      handleDeleteSelectedNode(removedStep.id);
      return;
    }

    let nextPositions = activeWorkflow.positions;
    let changed = false;

    for (const change of changes) {
      if (change.type === "position" && "id" in change && change.position) {
        nextPositions = updateWorkflowPositions(nextPositions, change.id, change.position);
        changed = true;
      }
    }

    if (changed) {
      applyActiveWorkflowUpdate((document) => ({
        ...document,
        positions: nextPositions
      }));
    }
  }

  function handleEdgesChange(changes: EdgeChange<Edge>[]) {
    if (!activeWorkflow) {
      return;
    }
    const nextEdges = applyEdgeChanges(changes, canvas.edges);
    applyActiveWorkflowUpdate((document) => ({
      ...document,
      workflow: updateWorkflowEdges(document.workflow, nextEdges)
    }));
    setLastAction("Updated workflow connections");
  }

  function handleConnect(connection: Connection) {
    if (!activeWorkflow || !connection.source || !connection.target) {
      return;
    }
    if (
      connection.source === TRIGGER_NODE_ID ||
      connection.target === TRIGGER_NODE_ID ||
      connection.source === connection.target
    ) {
      setLastAction("Trigger edges are derived from root steps and cannot be edited directly");
      return;
    }

    const nextEdges = addEdge(
      {
        ...connection,
        id: `${connection.source}->${connection.target}`
      },
      canvas.edges
    );
    applyActiveWorkflowUpdate((document) => ({
      ...document,
      workflow: updateWorkflowEdges(document.workflow, nextEdges)
    }));
    setLastAction(`Connected ${connection.source} to ${connection.target}`);
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
    setSelectedNodeId(createdNodeId);
    setLastAction(`Added ${newStepType} step`);
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
      setLastAction("Refreshed workflow inventory, tasks, and run history");
      setGlobalError(null);
    } catch (error) {
      setGlobalError(errorMessage(error));
      setLastAction("Refresh failed");
    }
  }

  async function handleRun() {
    if (!activeWorkflow) {
      return;
    }
    setIsRunning(true);
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
      setLastRun(response);
      setRunStatus(`${response.status} • ${response.run_id.slice(0, 8)}`);
      await refreshHumanTasks();
      await refreshRunHistory(response.run_id);
      setLastAction(
        response.status === "paused"
          ? `Run paused with ${response.pending_tasks.length} pending task(s)`
          : `Run completed successfully (${response.completed_steps} steps)`
      );
      setGlobalError(null);
    } catch (error) {
      setGlobalError(errorMessage(error));
      setLastAction("Workflow run failed");
    } finally {
      setIsRunning(false);
    }
  }

  async function handleSave() {
    if (!activeWorkflow) {
      return;
    }
    setIsSaving(true);
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
      setLastAction(`Saved ${response.summary.file_name}`);
      setGlobalError(null);
    } catch (error) {
      setGlobalError(errorMessage(error));
      setLastAction("Save failed");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSelectWorkflow(workflowId: string) {
    setActiveWorkflowId(workflowId);
    setSelectedNodeId(TRIGGER_NODE_ID);
    setGlobalError(null);
    if (!documents[workflowId]) {
      await loadWorkflowDocument(workflowId);
      return;
    }
    setLastAction(`Opened ${workflowId}.yaml`);
  }

  function handleWorkflowNameChange(name: string) {
    applyActiveWorkflowUpdate((document) => ({
      ...document,
      workflow: {
        ...document.workflow,
        name
      }
    }));
    setLastAction("Updated workflow name");
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
    setTriggerDetailsDraft(
      formatYaml(defaultTriggerDetailsForType(triggerType, activeWorkflow.id))
    );
    setLastAction(`Updated trigger type to ${triggerType}`);
  }

  function handleTriggerDetailsChange(text: string) {
    setTriggerDetailsDraft(text);
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
      setInspectorError(null);
    } catch (error) {
      setInspectorError(errorMessage(error));
    }
  }

  function handleSelectedNodeIdChange(value: string) {
    if (!activeWorkflow || !selectedNode || selectedNode.data.kind !== "step") {
      return;
    }
    const nextId = slugifyIdentifier(value);
    if (!nextId) {
      setInspectorError("Step ids must not be empty.");
      return;
    }
    if (
      activeWorkflow.workflow.steps.some(
        (step) => step.id === nextId && step.id !== selectedNode.id
      )
    ) {
      setInspectorError(`A step named ${nextId} already exists.`);
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
    setSelectedNodeId(nextId);
    setInspectorError(null);
    setLastAction(`Renamed step ${selectedNode.id} to ${nextId}`);
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
    setInspectorError(null);
    setLastAction(`Changed ${selectedNode.id} to ${typeName}`);
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
    setStepParamsDraft(text);
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
      setInspectorError(null);
    } catch (error) {
      setInspectorError(errorMessage(error));
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
      setInspectorError("Workflows must keep at least one step.");
      return;
    }

    applyActiveWorkflowUpdate((document) => ({
      ...document,
      positions: omitPosition(document.positions, targetStepId),
      workflow: removeStepFromWorkflow(document.workflow, targetStepId)
    }));
    setSelectedNodeId(TRIGGER_NODE_ID);
    setInspectorError(null);
    setLastAction(`Removed step ${targetStepId}`);
  }

  function handleTaskValueChange(taskId: string, value: string) {
    setTaskValues((current) => ({
      ...current,
      [taskId]: value
    }));
  }

  async function handleApprovalTask(taskId: string, approved: boolean) {
    await resolveTask(taskId, { approved });
  }

  async function handleManualInputTask(taskId: string) {
    const value = taskValues[taskId] ?? "";
    if (!value.trim()) {
      setGlobalError("Manual input tasks require a value before resuming the run.");
      return;
    }
    await resolveTask(taskId, { value });
    setTaskValues((current) => {
      const nextValues = { ...current };
      delete nextValues[taskId];
      return nextValues;
    });
  }

  async function resolveTask(taskId: string, payload: Record<string, unknown>) {
    setIsRefreshingTasks(true);
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
      setLastRun(response);
      setRunStatus(`${response.status} • ${response.run_id.slice(0, 8)}`);
      await refreshHumanTasks();
      await refreshRunHistory(response.run_id);
      setLastAction(
        response.status === "paused"
          ? `Resolved task ${taskId} and the run paused again`
          : `Resolved task ${taskId} and resumed the run`
      );
      setGlobalError(null);
    } catch (error) {
      setGlobalError(errorMessage(error));
      setLastAction(`Failed to resolve task ${taskId}`);
    } finally {
      setIsRefreshingTasks(false);
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
                  className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-ink outline-none transition focus:border-tide/40"
                  onChange={(event) => setNewStepType(event.target.value)}
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
                  className="rounded-full bg-tide px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0d5b61]"
                  onClick={handleAddStep}
                  type="button"
                >
                  Add step
                </button>
                <div className="rounded-full bg-ember/15 px-3 py-1 text-xs font-semibold text-ember">
                  YAML remains the source of truth
                </div>
              </div>
            </div>

            <div className="h-[680px]">
              {activeWorkflow ? (
                <ReactFlowProvider>
                  <ReactFlow
                    fitView
                    edges={canvas.edges}
                    nodes={canvas.nodes}
                    onConnect={handleConnect}
                    onEdgesChange={handleEdgesChange}
                    onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                    onNodesChange={handleNodesChange}
                    onPaneClick={() => setSelectedNodeId(null)}
                  >
                    <MiniMap
                      pannable
                      zoomable
                      className="!rounded-2xl !border !border-black/10 !bg-white/80"
                    />
                    <Controls className="!rounded-2xl !border !border-black/10 !bg-white/80" />
                    <Background
                      color="#b5c3c5"
                      gap={20}
                      size={1}
                      variant={BackgroundVariant.Dots}
                    />
                  </ReactFlow>
                </ReactFlowProvider>
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
          onLogLevelFilterChange={setLogLevelFilter}
          onLogSearchChange={setLogSearch}
          onRefresh={() => void refreshRunHistory(selectedRunId)}
          onRunStatusFilterChange={setRunStatusFilter}
          onRunWorkflowFilterChange={setRunWorkflowFilter}
          onSelectRun={setSelectedRunId}
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

async function fetchEngineJson<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${ENGINE_PROXY_BASE}${path}`, {
    cache: "no-store",
    ...init
  });
  const body = await response.text();
  if (!body.trim()) {
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    return {} as T;
  }

  let parsed: { error?: string } & T;
  try {
    parsed = JSON.parse(body) as { error?: string } & T;
  } catch {
    throw new Error(
      `Failed to parse JSON response (status ${response.status}): ${body}`
    );
  }

  if (!response.ok) {
    throw new Error(
      parsed && typeof parsed === "object" && typeof parsed.error === "string"
        ? parsed.error
        : `Request failed with status ${response.status}`
    );
  }

  return parsed as T;
}

async function fetchEngineText(
  path: string,
  init?: RequestInit
): Promise<string> {
  const response = await fetch(`${ENGINE_PROXY_BASE}${path}`, {
    cache: "no-store",
    ...init
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(body || `Request failed with status ${response.status}`);
  }
  return body;
}

async function fetchEngineNoContent(
  path: string,
  init?: RequestInit
) {
  const response = await fetch(`${ENGINE_PROXY_BASE}${path}`, {
    cache: "no-store",
    ...init
  });

  if (!response.ok) {
    const body = await response.text();
    const parsed = body ? (JSON.parse(body) as { error?: string }) : undefined;
    throw new Error(
      parsed && typeof parsed.error === "string"
        ? parsed.error
        : `Request failed with status ${response.status}`
    );
  }
}

function finalizeDocument(document: WorkflowDocument): WorkflowDocument {
  const allowedPositionKeys = new Set([
    TRIGGER_NODE_ID,
    ...document.workflow.steps.map((step) => step.id)
  ]);
  const positions = Object.fromEntries(
    Object.entries(document.positions).filter(([key]) => allowedPositionKeys.has(key))
  );

  return {
    ...document,
    dirty: true,
    positions,
    summary: summarizeWorkflow(document.id, document.workflow),
    yaml: workflowToYaml(document.workflow)
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

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
