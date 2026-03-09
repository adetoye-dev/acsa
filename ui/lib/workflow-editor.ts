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
  version: string;
};

export type WorkflowSummary = {
  description: string;
  file_name: string;
  has_connector_steps: boolean;
  id: string;
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

export type CanvasNodeData = {
  description: string;
  kind: "step" | "trigger";
  label: string;
  nodeId: string;
  runtime?: string | null;
  source?: string;
  typeName: string;
};

export type CanvasNode = Node<CanvasNodeData>;

export type WorkflowDocument = {
  dirty: boolean;
  id: string;
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
  const nextIndex = nextStepIndex(workflow.steps, typeName);
  const stepId = `${slugifyIdentifier(typeName)}_${nextIndex}`;
  const createdStep: StepDefinition = {
    id: stepId,
    next: [],
    params: defaultStepParamsForType(typeName),
    type: typeName
  };

  return {
    selectedNodeId: stepId,
    workflow: {
      ...workflow,
      steps: [...workflow.steps, createdStep]
    }
  };
}

export function createBlankWorkflow(workflowId: string): WorkflowDefinition {
  const normalizedId = slugifyIdentifier(workflowId || "workflow");
  return {
    name: normalizedId.replace(/-/g, " "),
    steps: [
      {
        id: "start",
        next: [],
        params: defaultStepParamsForType("constant"),
        type: "constant"
      }
    ],
    trigger: {
      type: "manual",
      ...defaultTriggerDetailsForType("manual", normalizedId)
    },
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
  return {
    ...workflow,
    steps: workflow.steps
      .filter((step) => step.id !== stepId)
      .map((step) => ({
        ...step,
        next: step.next.filter((candidate) => candidate !== stepId)
      }))
  };
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
  workflow: WorkflowDefinition
): WorkflowSummary {
  return {
    description: describeWorkflow(workflow),
    file_name: `${workflowId}.yaml`,
    has_connector_steps: workflow.steps.some((step) => !isBuiltInStepType(step.type)),
    id: workflowId,
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

  return {
    ...workflow,
    steps: workflow.steps.map((step) => ({
      ...step,
      next: nextByStep.get(step.id) ?? []
    }))
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
  existing?: WorkflowDocument
): WorkflowDocument {
  const workflow = parseWorkflowYaml(response.yaml);
  return {
    dirty: false,
    id: response.id,
    positions: existing?.positions ?? {},
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
  const predecessorCounts = new Map<string, number>(workflow.steps.map((step) => [step.id, 0]));
  for (const step of workflow.steps) {
    for (const target of step.next) {
      predecessorCounts.set(target, (predecessorCounts.get(target) ?? 0) + 1);
    }
  }

  const nextPositions = { ...positions };
  const nodes: CanvasNode[] = [
    {
      id: TRIGGER_NODE_ID,
      position: positions[TRIGGER_NODE_ID] ?? { x: 80, y: 200 },
      type: "input",
      data: {
        description: "Workflow trigger definition. Edit trigger settings in the inspector.",
        kind: "trigger",
        label: workflow.name,
        nodeId: TRIGGER_NODE_ID,
        typeName: workflow.trigger.type
      }
    }
  ];

  workflow.steps.forEach((step, index) => {
    const fallbackPosition = {
      x: 340 + (index % 3) * 280,
      y: 120 + Math.floor(index / 3) * 180
    };
    const position = positions[step.id] ?? fallbackPosition;
    nextPositions[step.id] = position;
    const catalogEntry = stepLookup.get(step.type);
    nodes.push({
      id: step.id,
      position,
      data: {
        description: catalogEntry?.description ?? "Connector or custom step.",
        kind: "step",
        label: step.id,
        nodeId: step.id,
        runtime: catalogEntry?.runtime ?? null,
        source: catalogEntry?.source ?? "workflow",
        typeName: step.type
      }
    });
  });
  nextPositions[TRIGGER_NODE_ID] = positions[TRIGGER_NODE_ID] ?? { x: 80, y: 200 };

  const edges: Edge[] = [];
  for (const step of workflow.steps) {
    if ((predecessorCounts.get(step.id) ?? 0) === 0) {
      edges.push({
        id: `${TRIGGER_NODE_ID}->${step.id}`,
        source: TRIGGER_NODE_ID,
        target: step.id,
        animated: true,
        deletable: false,
        selectable: false,
        style: { strokeDasharray: "6 4" }
      });
    }
    for (const target of step.next) {
      edges.push({
        id: `${step.id}->${target}`,
        markerEnd: {
          type: MarkerType.ArrowClosed
        },
        source: step.id,
        target
      });
    }
  }

  return { edges, nodes, positions: nextPositions };
}

export function workflowToYaml(workflow: WorkflowDefinition): string {
  return YAML.stringify(cleanWorkflow(workflow)).trim();
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
    version:
      typeof workflow.version === "string" && workflow.version.trim()
        ? workflow.version
        : "v1"
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
