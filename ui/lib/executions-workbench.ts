import type {
  RunDetailResponse,
  RunPageResponse,
  RunView,
  StepRunView
} from "./observability";

export type ExecutionDetailPane = "input" | "logs" | "output";

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

export { runProvenanceNote as executionProvenanceNote } from "./observability";
