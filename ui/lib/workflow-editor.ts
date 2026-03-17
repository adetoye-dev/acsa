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

import {
  MarkerType,
  type Edge,
  type Node,
  type XYPosition
} from "@xyflow/react";
import YAML from "yaml";

export const ENGINE_PROXY_BASE = "/engine";
export const EDGE_STROKE = "rgba(121, 141, 242, 0.68)";
export const TRIGGER_EDGE_STROKE = "rgba(244, 166, 97, 0.58)";
export const TRIGGER_NODE_ID = "__trigger__";

export type RetryPolicy = {
  attempts: number;
  backoff_ms?: number;
};

export type StepDefinition = {
  id: string;
  next: string[];
  params: Record<string, unknown>;
  retry?: RetryPolicy;
  timeout_ms?: number;
  type: string;
};

export type TriggerDefinition = {
  type: string;
} & Record<string, unknown>;

export type WorkflowDefinition = {
  name: string;
  steps: StepDefinition[];
  trigger: TriggerDefinition;
  ui?: WorkflowUiDefinition;
  version: string;
};

export type WorkflowUiDefinition = {
  detached_steps?: string[];
  positions?: Record<string, XYPosition>;
};

export type WorkflowSummary = {
  description: string;
  file_name: string;
  has_connector_steps: boolean;
  id: string;
  local_draft?: boolean;
  name: string;
  step_count: number;
  trigger_type: string;
};

export type InvalidWorkflowFile = {
  error: string;
  file_name: string;
  id: string;
};

export type WorkflowDocumentResponse = {
  id: string;
  summary: WorkflowSummary;
  yaml: string;
};

export type StepTypeEntry = {
  category: string;
  description: string;
  label: string;
  runtime?: string | null;
  source: string;
  type_name: string;
};

export type TriggerTypeEntry = {
  description: string;
  label: string;
  type_name: string;
};

export type HumanTask = {
  completed_at?: number | null;
  created_at: number;
  details?: unknown;
  field?: string | null;
  id: string;
  kind: string;
  prompt: string;
  response?: unknown;
  run_id: string;
  status: string;
  step_id: string;
  step_run_id: string;
};

export type PendingTask = {
  field?: string | null;
  id: string;
  kind: string;
  prompt: string;
  step_id: string;
};

export type RunSummary = {
  completed_steps: number;
  pending_tasks: PendingTask[];
  run_id: string;
  status: "paused" | "success";
  workflow_name: string;
};

export type RunStartResponse = {
  run_id: string;
  status: "running";
  workflow_name: string;
};

export type NodeExecutionState =
  | "idle"
  | "failed"
  | "paused"
  | "running"
  | "skipped"
  | "success";

export type CanvasNodeData = {
  category?: string | null;
  description: string;
  detached?: boolean;
  executionLabel?: string | null;
  executionMeta?: string | null;
  executionState?: NodeExecutionState;
  kind: "step" | "trigger";
  label: string;
  onAddAfter?: ((nodeId: string) => void) | null;
  nodeId: string;
  onDelete?: ((nodeId: string) => void) | null;
  runtime?: string | null;
  source?: string;
  typeName: string;
};

export type CanvasNode = Node<CanvasNodeData>;

export type WorkflowDocument = {
  dirty: boolean;
  id: string;
  localDraft: boolean;
  positions: Record<string, XYPosition>;
  summary: WorkflowSummary;
  workflow: WorkflowDefinition;
  yaml: string;
};

type WorkflowRecord = Record<string, unknown>;

export function addStepToWorkflow(
  workflow: WorkflowDefinition,
  typeName: string
): { selectedNodeId: string; workflow: WorkflowDefinition } {
  const { createdStep, stepId } = createStepForType(workflow, typeName);

  return {
    selectedNodeId: stepId,
    workflow: {
      ...workflow,
      steps: [...workflow.steps, createdStep],
      ui: {
        ...workflow.ui,
        detached_steps: Array.from(
          new Set([...(workflow.ui?.detached_steps ?? []), stepId])
        )
      }
    }
  };
}

export function addStepAfterNode(
  workflow: WorkflowDefinition,
  typeName: string,
  sourceNodeId: string
): { selectedNodeId: string; workflow: WorkflowDefinition } {
  const { createdStep, stepId } = createStepForType(workflow, typeName);
  const detachedSteps = new Set(workflow.ui?.detached_steps ?? []);
  detachedSteps.delete(stepId);

  return {
    selectedNodeId: stepId,
    workflow: cleanWorkflow({
      ...workflow,
      steps:
        sourceNodeId === TRIGGER_NODE_ID
          ? [...workflow.steps, createdStep]
          : workflow.steps.map((step) =>
              step.id === sourceNodeId
                ? {
                    ...step,
                    next: Array.from(new Set([...step.next, stepId]))
                  }
                : step
            ).concat(createdStep),
      ui: {
        ...(workflow.ui ?? {}),
        ...(detachedSteps.size > 0
          ? { detached_steps: Array.from(detachedSteps) }
          : {})
      }
    })
  };
}

export function insertStepBetweenNodes(
  workflow: WorkflowDefinition,
  typeName: string,
  sourceNodeId: string,
  targetNodeId: string
): { selectedNodeId: string; workflow: WorkflowDefinition } {
  if (sourceNodeId !== TRIGGER_NODE_ID) {
    const sourceStep = workflow.steps.find((step) => step.id === sourceNodeId);
    if (!sourceStep || !sourceStep.next.includes(targetNodeId)) {
      return { selectedNodeId: targetNodeId, workflow };
    }
  }

  const { createdStep, stepId } = createStepForType(workflow, typeName, [targetNodeId]);
  const detachedSteps = new Set(workflow.ui?.detached_steps ?? []);
  detachedSteps.delete(stepId);

  return {
    selectedNodeId: stepId,
    workflow: cleanWorkflow({
      ...workflow,
      steps:
        sourceNodeId === TRIGGER_NODE_ID
          ? [...workflow.steps, createdStep]
          : workflow.steps.map((step) =>
              step.id === sourceNodeId
                ? {
                    ...step,
                    next: step.next.flatMap((candidate) =>
                      candidate === targetNodeId ? [stepId] : [candidate]
                    )
                  }
                : step
            ).concat(createdStep),
      ui: {
        ...(workflow.ui ?? {}),
        ...(detachedSteps.size > 0
          ? { detached_steps: Array.from(detachedSteps) }
          : {})
      }
    })
  };
}

export function createBlankWorkflow(workflowId: string): WorkflowDefinition {
  const normalizedId = slugifyIdentifier(workflowId || "workflow");
  return {
    name: normalizedId.replace(/-/g, " "),
    steps: [],
    trigger: {
      type: "manual",
      ...defaultTriggerDetailsForType("manual", normalizedId)
    },
    ui: {},
    version: "v1"
  };
}

export function defaultStepParamsForType(typeName: string): Record<string, unknown> {
  return defaultStepParams(typeName);
}

export function defaultTriggerDetailsForType(
  triggerType: string,
  workflowId: string
): Record<string, unknown> {
  switch (triggerType) {
    case "cron":
      return { schedule: "0 */15 * * * *" };
    case "webhook":
      return {
        header: "x-acsa-webhook-token",
        path: `/hooks/${slugifyIdentifier(workflowId)}`,
        secret_env: "ACSA_WEBHOOK_SECRET"
      };
    default:
      return {};
  }
}

export function describeWorkflow(workflow: WorkflowDefinition): string {
  const stepLabel = workflow.steps.length === 1 ? "step" : "steps";
  return `${workflow.trigger.type} trigger, ${workflow.steps.length} ${stepLabel}`;
}

export function createLocalWorkflowDocument(workflowId: string): WorkflowDocument {
  const workflow = createBlankWorkflow(workflowId);
  const normalizedId = slugifyIdentifier(workflowId || "workflow");
  return {
    dirty: true,
    id: normalizedId,
    localDraft: true,
    positions: {},
    summary: summarizeWorkflow(normalizedId, workflow, { localDraft: true }),
    workflow,
    yaml: workflowToYaml(workflow)
  };
}

export function extractTriggerDetails(trigger: TriggerDefinition): Record<string, unknown> {
  const { type: _type, ...details } = trigger;
  return details;
}

export function formatYaml(value: unknown): string {
  return YAML.stringify(value).trim();
}

export function parseObjectYaml(text: string): Record<string, unknown> {
  const parsed = YAML.parse(text || "{}");
  if (parsed === null || parsed === undefined) {
    return {};
  }
  if (!isRecord(parsed)) {
    throw new Error("Expected a YAML object.");
  }
  return parsed;
}

export function parseWorkflowYaml(text: string): WorkflowDefinition {
  const parsed = YAML.parse(text);
  return normalizeWorkflow(parsed);
}

export function removeStepFromWorkflow(
  workflow: WorkflowDefinition,
  stepId: string
): WorkflowDefinition {
  const removedStep = workflow.steps.find((step) => step.id === stepId);
  if (!removedStep) {
    return workflow;
  }

  const successorIds = removedStep.next.filter((candidate) => candidate !== stepId);
  const positions = normalizePositions(workflow.ui?.positions);
  if (positions) {
    delete positions[stepId];
  }

  const detachedSteps = (workflow.ui?.detached_steps ?? []).filter(
    (candidate) => candidate !== stepId
  );

  return cleanWorkflow({
    ...workflow,
    steps: workflow.steps
      .filter((step) => step.id !== stepId)
      .map((step) => {
        if (!step.next.includes(stepId)) {
          return step;
        }

        return {
          ...step,
          next: Array.from(
            new Set(
              step.next
                .flatMap((candidate) =>
                  candidate === stepId ? successorIds : [candidate]
                )
                .filter(
                  (candidate) => candidate !== stepId && candidate !== step.id
                )
            )
          )
        };
      }),
    ui:
      positions || detachedSteps.length > 0
        ? {
            ...(positions ? { positions } : {}),
            ...(detachedSteps.length > 0
              ? { detached_steps: detachedSteps }
              : {})
          }
        : undefined
  });
}

export function slugifyIdentifier(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "workflow";
}

export function summarizeWorkflow(
  workflowId: string,
  workflow: WorkflowDefinition,
  options?: { localDraft?: boolean }
): WorkflowSummary {
  return {
    description: describeWorkflow(workflow),
    file_name: `${workflowId}.yaml`,
    has_connector_steps: workflow.steps.some((step) => !isBuiltInStepType(step.type)),
    id: workflowId,
    ...(options?.localDraft ? { local_draft: true } : {}),
    name: workflow.name,
    step_count: workflow.steps.length,
    trigger_type: workflow.trigger.type
  };
}

export function updateWorkflowEdges(
  workflow: WorkflowDefinition,
  edges: Edge[]
): WorkflowDefinition {
  const nextByStep = new Map<string, string[]>();
  for (const step of workflow.steps) {
    nextByStep.set(step.id, []);
  }
  for (const edge of edges) {
    if (edge.source === TRIGGER_NODE_ID || edge.target === TRIGGER_NODE_ID) {
      continue;
    }
    const targets = nextByStep.get(edge.source);
    if (!targets) {
      continue;
    }
    if (!targets.includes(edge.target)) {
      targets.push(edge.target);
    }
  }

  const connectedTargets = new Set(
    edges
      .filter((edge) => edge.source !== TRIGGER_NODE_ID && edge.target !== TRIGGER_NODE_ID)
      .map((edge) => edge.target)
  );
  const triggerAttachedTargets = new Set(
    edges
      .filter((edge) => edge.source === TRIGGER_NODE_ID && edge.target !== TRIGGER_NODE_ID)
      .map((edge) => edge.target)
  );
  const detachedSteps = workflow.steps
    .map((step) => step.id)
    .filter(
      (stepId) => !connectedTargets.has(stepId) && !triggerAttachedTargets.has(stepId)
    );
  const positions = normalizePositions(workflow.ui?.positions);

  return {
    ...workflow,
    steps: workflow.steps.map((step) => ({
      ...step,
      next: nextByStep.get(step.id) ?? []
    })),
    ...(positions || detachedSteps.length > 0
      ? {
          ui: {
            ...(positions ? { positions } : {}),
            ...(detachedSteps.length > 0 ? { detached_steps: detachedSteps } : {})
          }
        }
      : {})
  };
}

export function updateWorkflowPositions(
  positions: Record<string, XYPosition>,
  nodeId: string,
  nextPosition: XYPosition
): Record<string, XYPosition> {
  return {
    ...positions,
    [nodeId]: nextPosition
  };
}

export function workflowDocumentFromResponse(
  response: WorkflowDocumentResponse,
  existing?: WorkflowDocument,
  storedPositions?: Record<string, XYPosition>
): WorkflowDocument {
  const workflow = parseWorkflowYaml(response.yaml);
  const yamlPositions = workflow.ui?.positions ?? {};
  return {
    dirty: false,
    id: response.id,
    localDraft: false,
    positions: {
      ...yamlPositions,
      ...(existing?.positions ?? {}),
      ...(storedPositions ?? {})
    },
    summary: response.summary,
    workflow,
    yaml: response.yaml
  };
}

export function workflowToCanvas(
  workflow: WorkflowDefinition,
  positions: Record<string, XYPosition>,
  stepCatalog: StepTypeEntry[]
): { edges: Edge[]; nodes: CanvasNode[]; positions: Record<string, XYPosition> } {
  const stepLookup = new Map(stepCatalog.map((entry) => [entry.type_name, entry]));
  const detachedSteps = new Set(workflow.ui?.detached_steps ?? []);
  const predecessorCounts = new Map<string, number>(workflow.steps.map((step) => [step.id, 0]));
  for (const step of workflow.steps) {
    for (const target of step.next) {
      predecessorCounts.set(target, (predecessorCounts.get(target) ?? 0) + 1);
    }
  }

  const nextPositions = {
    ...autoLayoutWorkflow(workflow),
    ...positions
  };
  const triggerPos = positions[TRIGGER_NODE_ID] ?? nextPositions[TRIGGER_NODE_ID] ?? { x: 80, y: 200 };
  const nodes: CanvasNode[] = [
    {
      id: TRIGGER_NODE_ID,
      position: triggerPos,
      type: "workflowNode",
      data: {
        category: "trigger",
        description: workflow.name,
        detached: false,
        kind: "trigger",
        label: `${titleCase(workflow.trigger.type)} trigger`,
        nodeId: TRIGGER_NODE_ID,
        onDelete: null,
        typeName: workflow.trigger.type
      }
    }
  ];

  workflow.steps.forEach((step, index) => {
    const fallbackPosition = nextPositions[step.id] ?? {
      x: 340 + index * 280,
      y: 160
    };
    const position = nextPositions[step.id] ?? fallbackPosition;
    nextPositions[step.id] = position;
    const catalogEntry = stepLookup.get(step.type);
    nodes.push({
      id: step.id,
      position,
      type: "workflowNode",
      data: {
        category: catalogEntry?.category ?? inferStepCategory(step.type, catalogEntry?.source),
        description: step.id,
        detached: detachedSteps.has(step.id),
        kind: "step",
        label: catalogEntry?.label ?? titleCase(step.type),
        nodeId: step.id,
        onDelete: null,
        runtime: catalogEntry?.runtime ?? null,
        source: catalogEntry?.source ?? "workflow",
        typeName: step.type
      }
    });
  });
  nextPositions[TRIGGER_NODE_ID] = triggerPos;

  const edges: Edge[] = [];
  for (const step of workflow.steps) {
    if ((predecessorCounts.get(step.id) ?? 0) === 0 && !detachedSteps.has(step.id)) {
      edges.push({
        id: `${TRIGGER_NODE_ID}->${step.id}`,
        source: TRIGGER_NODE_ID,
        target: step.id,
        deletable: false,
        selectable: false,
        markerEnd: {
          color: TRIGGER_EDGE_STROKE,
          height: 18,
          type: MarkerType.ArrowClosed,
          width: 18
        },
        type: "workflowEdge",
        style: {
          stroke: TRIGGER_EDGE_STROKE,
          strokeDasharray: "6 4",
          strokeWidth: 1.75
        }
      });
    }
    for (const target of step.next) {
      edges.push({
        id: `${step.id}->${target}`,
        markerEnd: {
          color: EDGE_STROKE,
          height: 18,
          type: MarkerType.ArrowClosed,
          width: 18
        },
        source: step.id,
        target,
        style: {
          stroke: EDGE_STROKE,
          strokeWidth: 2
        },
        type: "workflowEdge"
      });
    }
  }

  return { edges, nodes, positions: nextPositions };
}

export function workflowToYaml(workflow: WorkflowDefinition): string {
  return YAML.stringify(cleanWorkflow(workflow)).trim();
}

export function workflowHasRunnableSteps(workflow: WorkflowDefinition): boolean {
  return workflow.steps.length > 0;
}

export function autoLayoutWorkflow(workflow: WorkflowDefinition): Record<string, XYPosition> {
  const predecessors = new Map<string, string[]>();
  const successors = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  const topoIndex = new Map<string, number>();

  for (const step of workflow.steps) {
    predecessors.set(step.id, []);
    successors.set(step.id, [...step.next]);
    indegree.set(step.id, 0);
  }

  for (const step of workflow.steps) {
    for (const target of step.next) {
      predecessors.set(target, [...(predecessors.get(target) ?? []), step.id]);
      indegree.set(target, (indegree.get(target) ?? 0) + 1);
    }
  }

  const queue = workflow.steps
    .filter((step) => (indegree.get(step.id) ?? 0) === 0)
    .map((step) => step.id);
  const topo: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    topoIndex.set(current, topo.length);
    topo.push(current);
    for (const target of successors.get(current) ?? []) {
      const nextDegree = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, nextDegree);
      if (nextDegree === 0) {
        queue.push(target);
      }
    }
  }

  const order = topo.length > 0 ? topo : workflow.steps.map((step) => step.id);
  const depthByStep = new Map<string, number>();
  for (const stepId of order) {
    const parentDepths = (predecessors.get(stepId) ?? []).map(
      (parentId) => depthByStep.get(parentId) ?? 0
    );
    depthByStep.set(stepId, parentDepths.length > 0 ? Math.max(...parentDepths) + 1 : 1);
  }

  const stepsByDepth = new Map<number, string[]>();
  for (const stepId of order) {
    const depth = depthByStep.get(stepId) ?? 1;
    const bucket = stepsByDepth.get(depth) ?? [];
    bucket.push(stepId);
    stepsByDepth.set(depth, bucket);
  }

  const slotByStep = new Map<string, number>();
  const sortedDepths = Array.from(stepsByDepth.keys()).sort((left, right) => left - right);
  for (const depth of sortedDepths) {
    const sortedSteps = [...(stepsByDepth.get(depth) ?? [])].sort((left, right) => {
      const leftWeight = averageParentSlot(left, predecessors, slotByStep, topoIndex);
      const rightWeight = averageParentSlot(right, predecessors, slotByStep, topoIndex);
      if (leftWeight !== rightWeight) {
        return leftWeight - rightWeight;
      }
      return (topoIndex.get(left) ?? 0) - (topoIndex.get(right) ?? 0);
    });
    stepsByDepth.set(depth, sortedSteps);
    sortedSteps.forEach((stepId, index) => {
      slotByStep.set(stepId, index);
    });
  }

  const positions: Record<string, XYPosition> = {};
  const columnGap = 340;
  const rowGap = 190;
  const canvasMidline = 260;
  for (const depth of sortedDepths) {
    const stepIds = stepsByDepth.get(depth) ?? [];
    const offset = ((stepIds.length - 1) * rowGap) / 2;
    stepIds.forEach((stepId, index) => {
      positions[stepId] = {
        x: 340 + (depth - 1) * columnGap,
        y: Math.round(canvasMidline - offset + index * rowGap)
      };
    });
  }

  const rootPositions = (stepsByDepth.get(1) ?? [])
    .map((stepId) => positions[stepId]?.y)
    .filter((value): value is number => value !== undefined);
  const triggerY =
    rootPositions.length > 0
      ? Math.round(rootPositions.reduce((sum, value) => sum + value, 0) / rootPositions.length)
      : canvasMidline;
  positions[TRIGGER_NODE_ID] = { x: 84, y: triggerY };

  return positions;
}

export function withStepUpdated(
  workflow: WorkflowDefinition,
  stepId: string,
  updater: (step: StepDefinition) => StepDefinition
): WorkflowDefinition {
  return {
    ...workflow,
    steps: workflow.steps.map((step) => (step.id === stepId ? updater(step) : step))
  };
}

function cleanWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  const positions = normalizePositions(workflow.ui?.positions);
  const detachedSteps =
    workflow.ui?.detached_steps?.filter((stepId) =>
      workflow.steps.some((step) => step.id === stepId)
    ) ?? [];
  return {
    name: workflow.name.trim(),
    steps: workflow.steps.map((step) => ({
      ...step,
      next: Array.from(new Set(step.next)),
      params: step.params ?? {}
    })),
    trigger: {
      type: workflow.trigger.type,
      ...extractTriggerDetails(workflow.trigger)
    },
    ...(positions || detachedSteps.length > 0
      ? {
          ui: {
            ...(positions ? { positions } : {}),
            ...(detachedSteps.length > 0 ? { detached_steps: detachedSteps } : {})
          }
        }
      : {}),
    version: workflow.version || "v1"
  };
}

function defaultStepParams(typeName: string): Record<string, unknown> {
  switch (typeName) {
    case "approval":
      return { prompt: "Approve this automation run?" };
    case "classification":
      return { labels: ["urgent", "standard"], text_path: "payload.text" };
    case "condition":
      return {
        operator: "eq",
        path: "payload.status",
        value: "ok"
      };
    case "constant":
      return { value: { message: "hello from acsa" } };
    case "database_query":
      return { connection_env: "DATABASE_URL", query: "select 1 as ok" };
    case "embedding":
      return { collection: "default", text_path: "payload.text" };
    case "extraction":
      return { fields: ["summary"], text_path: "payload.text" };
    case "file_read":
      return { path: "notes/input.txt" };
    case "file_write":
      return { content: "hello from acsa", path: "notes/output.txt" };
    case "http_request":
      return { method: "GET", url: "https://example.com/health" };
    case "llm_completion":
      return { model: "provider/model", prompt: "Summarize the workflow context." };
    case "loop":
      return { items_path: "payload.items" };
    case "manual_input":
      return { field: "value", prompt: "Provide a value to continue." };
    case "parallel":
      return { branches: [] };
    case "retrieval":
      return { collection: "default", query_path: "payload.query" };
    case "switch":
      return { cases: {}, default: "" };
    default:
      return {};
  }
}

function inferStepCategory(typeName: string, source?: string | null): string {
  if (source && source !== "built_in") {
    return "integration";
  }

  if (/(llm|embedding|retrieval|classification|extraction|agent)/.test(typeName)) {
    return "ai";
  }
  if (/(approval|manual_input|human)/.test(typeName)) {
    return "human";
  }
  if (/(condition|switch|loop|parallel|if|branch)/.test(typeName)) {
    return "flow";
  }
  if (/(http|database|file|webhook)/.test(typeName)) {
    return "integration";
  }

  return "core";
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function isBuiltInStepType(typeName: string): boolean {
  return [
    "approval",
    "classification",
    "condition",
    "constant",
    "database_query",
    "embedding",
    "extraction",
    "file_read",
    "file_write",
    "http_request",
    "llm_completion",
    "loop",
    "manual_input",
    "noop",
    "parallel",
    "retrieval",
    "switch"
  ].includes(typeName);
}

function isRecord(value: unknown): value is WorkflowRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRetry(value: unknown): RetryPolicy | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const attempts = Number(value.attempts);
  if (!Number.isFinite(attempts) || attempts <= 0) {
    return undefined;
  }
  const backoff =
    value.backoff_ms === undefined ? undefined : Number(value.backoff_ms);
  return {
    attempts,
    ...(Number.isFinite(backoff) && backoff !== undefined ? { backoff_ms: backoff } : {})
  };
}

function normalizeStep(step: unknown, index: number): StepDefinition {
  if (!isRecord(step)) {
    throw new Error(`Workflow step ${index + 1} must be an object.`);
  }
  const id = asString(step.id, `steps[${index}].id`);
  const type = asString(step.type, `steps[${index}].type`);
  const params = step.params === undefined ? {} : asRecord(step.params, `steps[${index}].params`);
  const next = Array.isArray(step.next)
    ? step.next.map((value, targetIndex) =>
        asString(value, `steps[${index}].next[${targetIndex}]`)
      )
    : [];
  const timeoutValue =
    step.timeout_ms === undefined ? undefined : Number(step.timeout_ms);

  return {
    id,
    next,
    params,
    retry: normalizeRetry(step.retry),
    timeout_ms:
      timeoutValue !== undefined && Number.isFinite(timeoutValue)
        ? timeoutValue
        : undefined,
    type
  };
}

function normalizeWorkflow(input: unknown): WorkflowDefinition {
  if (!isRecord(input)) {
    throw new Error("Workflow YAML must contain a top-level object.");
  }
  const workflow = input as WorkflowRecord;
  const trigger = asRecord(workflow.trigger, "trigger");
  const stepsValue = workflow.steps;
  const steps: unknown[] =
    stepsValue === undefined || stepsValue === null
      ? []
      : Array.isArray(stepsValue)
        ? stepsValue
        : (() => {
            const workflowRef =
              (typeof workflow.id === "string" && workflow.id.trim()) ||
              (typeof workflow.name === "string" && workflow.name.trim()) ||
              "unknown";
            throw new Error(
              `Workflow ${workflowRef} has invalid steps: workflow.steps must be an array when present.`
            );
          })();

  return {
    name: asString(workflow.name, "name"),
    steps: steps.map(normalizeStep),
    trigger: {
      type: asString(trigger.type, "trigger.type"),
      ...Object.fromEntries(
        Object.entries(trigger).filter(([key]) => key !== "type")
      )
    },
    ...(isRecord(workflow.ui)
      ? { ui: normalizeUi(workflow.ui) }
      : {}),
    version:
      typeof workflow.version === "string" && workflow.version.trim()
        ? workflow.version
        : "v1"
  };
}

function normalizeUi(value: Record<string, unknown>): WorkflowUiDefinition {
  const positions = normalizePositions(value.positions);
  const detachedSteps = Array.isArray(value.detached_steps)
    ? value.detached_steps
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim())
    : [];
  return {
    ...(positions ? { positions } : {}),
    ...(detachedSteps.length > 0 ? { detached_steps: Array.from(new Set(detachedSteps)) } : {})
  };
}

function nextStepIndex(steps: StepDefinition[], typeName: string): number {
  const prefix = `${slugifyIdentifier(typeName)}_`;
  let maxSuffix = 0;

  for (const step of steps) {
    if (!step.id.startsWith(prefix)) {
      continue;
    }

    const suffix = step.id.slice(prefix.length);
    if (!suffix) {
      continue;
    }

    const parsed = Number.parseInt(suffix, 10);
    if (Number.isFinite(parsed) && parsed > maxSuffix) {
      maxSuffix = parsed;
    }
  }

  return maxSuffix + 1;
}

function createStepForType(
  workflow: WorkflowDefinition,
  typeName: string,
  next: string[] = []
) {
  const nextIndex = nextStepIndex(workflow.steps, typeName);
  const stepId = `${slugifyIdentifier(typeName)}_${nextIndex}`;
  const createdStep: StepDefinition = {
    id: stepId,
    next,
    params: defaultStepParamsForType(typeName),
    type: typeName
  };

  return { createdStep, stepId };
}

function asRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }
  return value;
}

function asString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value;
}

function normalizePositions(value: unknown): Record<string, XYPosition> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const positions: Record<string, XYPosition> = {};
  for (const [nodeId, rawPosition] of Object.entries(value)) {
    if (!isRecord(rawPosition)) {
      continue;
    }
    const x = Number(rawPosition.x);
    const y = Number(rawPosition.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    positions[nodeId] = { x, y };
  }

  return Object.keys(positions).length > 0 ? positions : undefined;
}

function averageParentSlot(
  stepId: string,
  predecessors: Map<string, string[]>,
  slotByStep: Map<string, number>,
  topoIndex: Map<string, number>
) {
  const parents = predecessors.get(stepId) ?? [];
  if (parents.length === 0) {
    return topoIndex.get(stepId) ?? 0;
  }
  const weights = parents.map((parentId) => slotByStep.get(parentId) ?? topoIndex.get(parentId) ?? 0);
  return weights.reduce((sum, value) => sum + value, 0) / weights.length;
}
