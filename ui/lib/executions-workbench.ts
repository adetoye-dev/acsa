import type { Edge } from "@xyflow/react";
import YAML from "yaml";

import {
  hasFallbackProvenance,
  runProvenanceNote,
  type RunDetailResponse,
  type RunPageResponse,
  type RunView,
  type StepRunView
} from "./observability";
import {
  type CanvasNode,
  type NodeExecutionState,
  type StepTypeEntry,
  TRIGGER_NODE_ID,
  type WorkflowDefinition,
  type WorkflowDocumentResponse,
  type WorkflowSummary,
  slugifyIdentifier,
  workflowDocumentFromResponse,
  workflowToCanvas
} from "./workflow-editor";

export type ExecutionDetailPane = "input" | "logs" | "output";

export type ExecutionCanvasState = {
  edges: Edge[];
  nodes: CanvasNode[];
};

export type ExecutionGraphViewModel = {
  canvas: ExecutionCanvasState | null;
  error: string | null;
  nodeLabels: Record<string, string>;
};

export function latestStepRunsByStep(stepRuns: StepRunView[]) {
  const latestByStep = new Map<string, StepRunView>();

  for (const stepRun of stepRuns) {
    const current = latestByStep.get(stepRun.step_id);
    if (
      !current ||
      stepRun.attempt > current.attempt ||
      (stepRun.attempt === current.attempt && stepRun.started_at > current.started_at)
    ) {
      latestByStep.set(stepRun.step_id, stepRun);
    }
  }

  return Array.from(latestByStep.values()).sort(
    (left, right) => left.started_at - right.started_at
  );
}

export function sortRunsNewestFirst(runs: RunView[]) {
  return [...runs].sort((left, right) => {
    if (right.started_at !== left.started_at) {
      return right.started_at - left.started_at;
    }

    const leftFinishedAt = left.finished_at ?? left.started_at;
    const rightFinishedAt = right.finished_at ?? right.started_at;
    if (rightFinishedAt !== leftFinishedAt) {
      return rightFinishedAt - leftFinishedAt;
    }

    return right.id.localeCompare(left.id);
  });
}

export function selectDefaultRun(
  runPage: RunPageResponse | null,
  currentRunId: string | null,
  preferredRunId?: string | null
) {
  const availableRuns = sortRunsNewestFirst(runPage?.runs ?? []);

  if (preferredRunId && availableRuns.some((run) => run.id === preferredRunId)) {
    return preferredRunId;
  }

  if (currentRunId && availableRuns.some((run) => run.id === currentRunId)) {
    return currentRunId;
  }

  return availableRuns[0]?.id ?? null;
}

export function selectDefaultStep(
  runDetail: RunDetailResponse | null,
  currentStepId: string | null
) {
  const stepRuns = latestStepRunsByStep(runDetail?.step_runs ?? []);
  if (currentStepId && stepRuns.some((stepRun) => stepRun.step_id === currentStepId)) {
    return currentStepId;
  }

  return (
    [...stepRuns].reverse().find((stepRun) => stepRun.status === "failed")?.step_id ??
    [...stepRuns].reverse().find((stepRun) => stepRun.status === "paused")?.step_id ??
    [...stepRuns].reverse().find((stepRun) => stepRun.status === "running")?.step_id ??
    stepRuns.at(-1)?.step_id ??
    null
  );
}

function executionProvenanceNote(run: RunView | null) {
  if (!run || !hasFallbackProvenance(run)) {
    return null;
  }

  return runProvenanceNote(run);
}

export function buildExecutionGraphViewModel(
  runDetail: RunDetailResponse | null,
  stepCatalog: StepTypeEntry[]
): ExecutionGraphViewModel {
  if (!runDetail) {
    return { canvas: null, error: null, nodeLabels: {} };
  }

  try {
    if (!runDetail.workflow_snapshot?.trim()) {
      return {
        canvas: null,
        error: "This run does not include a workflow snapshot.",
        nodeLabels: {}
      };
    }

    const workflowId = slugifyIdentifier(runDetail.run.workflow_name);
    const fallbackSummary = buildSnapshotSummary(workflowId, runDetail.run.workflow_name);
    const storedPositions = extractEditorSnapshotPositions(runDetail.editor_snapshot);
    let nextCanvasState: ExecutionCanvasState;

    try {
      const response: WorkflowDocumentResponse = {
        id: workflowId,
        summary: fallbackSummary,
        yaml: runDetail.workflow_snapshot
      };
      const document = workflowDocumentFromResponse(response, undefined, storedPositions);
      const nextCanvas = workflowToCanvas(document.workflow, document.positions, stepCatalog);
      nextCanvasState = {
        edges: nextCanvas.edges,
        nodes: decorateNodesForExecution(nextCanvas.nodes, document.workflow.name, runDetail)
      };
    } catch {
      const workflow = JSON.parse(runDetail.workflow_snapshot) as WorkflowDefinition;
      const nextCanvas = workflowToCanvas(
        workflow,
        {
          ...(workflow.ui?.positions ?? {}),
          ...(storedPositions ?? {})
        },
        stepCatalog
      );
      nextCanvasState = {
        edges: nextCanvas.edges,
        nodes: decorateNodesForExecution(nextCanvas.nodes, workflow.name, runDetail)
      };
    }

    return {
      canvas: nextCanvasState,
      error: null,
      nodeLabels: Object.fromEntries(
        nextCanvasState.nodes
          .filter((node) => node.data.kind === "step")
          .map((node) => [node.id, node.data.label])
      )
    };
  } catch (error) {
    return {
      canvas: null,
      error: error instanceof Error ? error.message : "Failed to build execution graph",
      nodeLabels: {}
    };
  }
}

function buildLatestStepRunMap(stepRuns: StepRunView[]) {
  const latestByStep = new Map<string, StepRunView>();
  for (const stepRun of stepRuns) {
    const current = latestByStep.get(stepRun.step_id);
    if (
      !current ||
      stepRun.attempt > current.attempt ||
      (stepRun.attempt === current.attempt && stepRun.started_at > current.started_at)
    ) {
      latestByStep.set(stepRun.step_id, stepRun);
    }
  }

  return latestByStep;
}

function decorateNodesForExecution(
  nodes: CanvasNode[],
  workflowName: string | null,
  runDetail: RunDetailResponse | null
) {
  if (!runDetail || (workflowName && runDetail.run.workflow_name !== workflowName)) {
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

  const latestByStep = buildLatestStepRunMap(runDetail.step_runs);
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

    const latestStepRun = latestByStep.get(node.id);
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
    case "success":
      return "success";
    case "failed":
      return "failed";
    case "paused":
      return "paused";
    case "running":
      return "running";
    case "skipped":
      return "skipped";
    default:
      return null;
  }
}

function executionMeta(state: NodeExecutionState, stepRun: StepRunView) {
  switch (state) {
    case "running":
      return `attempt ${stepRun.attempt}`;
    case "success":
    case "failed":
    case "paused":
    case "skipped":
      return formatStepDuration(stepRun.duration_seconds);
    default:
      return null;
  }
}

function formatStepDuration(seconds?: number | null) {
  if (seconds === null || seconds === undefined) {
    return "In progress";
  }
  if (seconds < 1) {
    return "<1s";
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function buildSnapshotSummary(
  workflowId: string,
  workflowName: string
): WorkflowSummary {
  return {
    description: workflowName,
    file_name: `${workflowId}.yaml`,
    has_connector_steps: false,
    id: workflowId,
    name: workflowName,
    step_count: 0,
    trigger_type: "manual",
    workflow_state: {
      lifecycle: "saved",
      readiness: {
        connector_requirements: {
          required_step_types: []
        },
        readiness_state: "ready",
        validation_state: "valid"
      },
      telemetry: {
        last_run_at: null,
        last_run_status: null
      }
    }
  };
}

function extractEditorSnapshotPositions(
  editorSnapshot?: string | null
): Record<string, { x: number; y: number }> | undefined {
  if (!editorSnapshot?.trim()) {
    return undefined;
  }

  try {
    const document = YAML.parse(editorSnapshot) as
      | { ui?: { positions?: Record<string, unknown> } }
      | null;
    const positionsValue = document?.ui?.positions;

    if (
      !positionsValue ||
      typeof positionsValue !== "object" ||
      Array.isArray(positionsValue)
    ) {
      return undefined;
    }

    const positions = Object.fromEntries(
      Object.entries(positionsValue).flatMap(([nodeId, positionValue]) => {
        if (
          !positionValue ||
          typeof positionValue !== "object" ||
          Array.isArray(positionValue)
        ) {
          return [];
        }

        const x = (positionValue as { x?: unknown }).x;
        const y = (positionValue as { y?: unknown }).y;

        if (typeof x !== "number" || typeof y !== "number") {
          return [];
        }

        return [[nodeId, { x, y }] as const];
      })
    );

    return positions;
  } catch {
    return undefined;
  }
}
