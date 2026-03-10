# Observability

## Available endpoints

- `GET /metrics`
  - Returns Prometheus-style counters, gauges, and histograms for workflow runs and step attempts.
- `GET /api/runs?page=1&page_size=12&status=success&workflow_name=manual-demo`
  - Returns paginated run history with optional status and workflow filters.
- `GET /api/runs/{run_id}`
  - Returns run metadata, step attempts, and any human tasks tied to the run.
- `GET /api/runs/{run_id}/logs?page=1&page_size=50&level=error&search=timeout`
  - Returns paginated execution logs with optional level and text filters.

## Metrics emitted

- `acsa_workflow_runs_total`
- `acsa_workflow_runs_success_total`
- `acsa_workflow_runs_failed_total`
- `acsa_workflow_runs_paused_total`
- `acsa_workflow_runs_running_total`
- `acsa_step_executions_total`
- `acsa_step_failures_total`
- `acsa_step_retries_total`
- `acsa_workflow_average_duration_seconds`
- `acsa_workflow_duration_seconds`
- `acsa_step_duration_seconds`

Workflow and step duration metrics are exported as histogram series with fixed buckets.

## Redaction behavior

- Structured logs are persisted through the SQLite `logs` table.
- File and API log output pass through the same redaction helper.
- Sensitive keys such as `secret`, `token`, `password`, `api_key`, `access_key`, and `private_key` are masked.
- Long credential-like strings and common inline secret formats are masked before persistence.
- Set `ACSA_LOG_PAYLOADS=0` to suppress step input and output payloads in run detail responses.

## Retention controls

- `ACSA_LOG_RETENTION_DAYS`
  - Deletes log rows older than the configured number of days.
- `ACSA_RUN_RETENTION_DAYS`
  - Deletes finished runs, step runs, and related human tasks older than the configured number of days.

Retention cleanup runs in the background when the HTTP server starts. If neither variable is set, no automatic purging is performed.

## File logging

- `ACSA_LOG_FILE_PATH=/absolute/path/to/acsa.log`
  - Appends redacted structured log lines to the given file in addition to SQLite persistence and stdout tracing.

## UI surface

The Next.js editor uses the observability endpoints to provide:

- run summary cards
- workflow and status filters
- run selection and step timelines
- log level and text filtering
- persisted human-task visibility per run
