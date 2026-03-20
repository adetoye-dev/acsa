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

export type HumanTaskView = {
  completed_at?: number | null;
  created_at: number;
  details?: string | null;
  field?: string | null;
  id: string;
  kind: string;
  prompt: string;
  response?: string | null;
  run_id: string;
  status: string;
  step_id: string;
  step_run_id: string;
};

export type RunProvenanceMode = "exact" | "fallback";

export type RunProvenance = {
  fallback_message?: string | null;
  message: string;
  mode: RunProvenanceMode;
};

export type LogPageResponse = {
  logs: RunLogRecord[];
  page: number;
  page_size: number;
  total: number;
};

export type MetricsSummary = {
  stepExecutions: number;
  stepFailures: number;
  stepRetries: number;
  workflowAverageDurationSeconds: number;
  workflowRunsFailed: number;
  workflowRunsPaused: number;
  workflowRunsSuccess: number;
  workflowRunsTotal: number;
};

export type RunDetailResponse = {
  editor_snapshot?: string | null;
  human_tasks: HumanTaskView[];
  run: RunView;
  step_runs: StepRunView[];
  workflow_snapshot?: string | null;
};

export type RunLogRecord = {
  id: string;
  level: string;
  message: string;
  run_id?: string | null;
  step_id?: string | null;
  timestamp: number;
};

export type RunPageResponse = {
  page: number;
  page_size: number;
  runs: RunView[];
  total: number;
};

export type RunView = {
  duration_seconds?: number | null;
  error_message?: string | null;
  finished_at?: number | null;
  id: string;
  run_provenance: RunProvenance;
  started_at: number;
  status: string;
  workflow_revision?: string | null;
  workflow_name: string;
};

export type StepRunView = {
  attempt: number;
  duration_seconds?: number | null;
  error_message?: string | null;
  finished_at?: number | null;
  id: string;
  input?: string | null;
  output?: string | null;
  started_at: number;
  status: string;
  step_id: string;
};

export function formatDuration(seconds?: number | null) {
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

export function formatTimestamp(value?: number | null) {
  if (!value) {
    return "Pending";
  }
  return new Date(value * 1000).toLocaleString();
}

export function runProvenanceLabel(run: RunView) {
  return run.run_provenance.mode === "exact" ? "Exact snapshot" : "Fallback rendering";
}

export function runProvenanceTone(run: RunView) {
  return run.run_provenance.mode === "exact"
    ? "bg-emerald-50 text-[#2e7b54]"
    : "bg-amber-50 text-[#a76825]";
}

export function hasFallbackProvenance(run: RunView) {
  return run.run_provenance.mode === "fallback";
}

export function runProvenanceNote(run: RunView) {
  return run.run_provenance.mode === "exact"
    ? "Showing the recorded snapshot for this run."
    : "Showing a fallback rendering for this run.";
}

export function parseMetricsSummary(metricsText: string): MetricsSummary {
  const metrics = new Map<string, number>();
  for (const line of metricsText.split("\n")) {
    if (!line || line.startsWith("#")) {
      continue;
    }
    const [metric, rawValue] = line.split(/\s+/, 2);
    if (!metric || !rawValue || metric.includes("{")) {
      continue;
    }
    const numericValue = Number(rawValue);
    if (Number.isFinite(numericValue)) {
      metrics.set(metric, numericValue);
    }
  }

  return {
    stepExecutions: metrics.get("acsa_step_executions_total") ?? 0,
    stepFailures: metrics.get("acsa_step_failures_total") ?? 0,
    stepRetries: metrics.get("acsa_step_retries_total") ?? 0,
    workflowAverageDurationSeconds:
      metrics.get("acsa_workflow_average_duration_seconds") ?? 0,
    workflowRunsFailed: metrics.get("acsa_workflow_runs_failed_total") ?? 0,
    workflowRunsPaused: metrics.get("acsa_workflow_runs_paused_total") ?? 0,
    workflowRunsSuccess: metrics.get("acsa_workflow_runs_success_total") ?? 0,
    workflowRunsTotal: metrics.get("acsa_workflow_runs_total") ?? 0
  };
}
