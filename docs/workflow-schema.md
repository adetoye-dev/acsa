# Workflow Schema

Acsa workflows are stored as YAML and will evolve under a versioned schema.

## Baseline Shape

```yaml
version: v1
name: hello-http
trigger:
  type: cron
  schedule: "0 */6 * * * *"
steps:
  - id: fetch_status
    type: http_request
    params:
      method: GET
      url: https://example.com/health
    next: []
```

## Phase 4 Shape

```yaml
version: v1
name: incoming-review
trigger:
  type: webhook
  path: /hooks/incoming-review
  secret_env: ACSA_WEBHOOK_SECRET
steps:
  - id: classify_priority
    type: condition
    params:
      path: body.priority
      operator: eq
      value: urgent
      when_true: urgent_lane
      when_false: standard_lane
    next: [urgent_lane, standard_lane]
  - id: urgent_lane
    type: constant
    params:
      value:
        queue: escalations
        severity: high
    next: [join]
  - id: standard_lane
    type: constant
    params:
      value:
        queue: triage
        severity: normal
    next: [join]
  - id: join
    type: noop
    params:
      label: webhook processed
    next: []
```

## Field reference

- `version`: schema version identifier. Phase 2 uses `v1`.
- `name`: unique human-readable workflow name.
- `trigger.type`: trigger identifier such as `manual`, `cron`, or `webhook`.
- `trigger.*`: trigger-specific properties.
  - `manual`: no additional required fields.
  - `cron`: requires `schedule` or `expression`.
  - `webhook`: canonical field is `secret_env`; the workflow API also accepts `secrets_env` and `token_env` for compatibility. `path` and `header` are optional.
- `steps[].id`: stable step identifier.
- `steps[].type`: node or connector type.
  - Built-in logic: `constant`, `noop`, `condition`, `switch`, `loop`, `parallel`
  - Built-in integration: `http_request`, `database_query`, `file_read`, `file_write`
  - Built-in AI: `llm_completion`, `classification`, `extraction`, `embedding`, `retrieval`
  - Built-in human gate nodes: `approval`, `manual_input`
  - Connector-defined types are loaded from `connectors/*/manifest.json`
- `steps[].params`: arbitrary parameter object for the step runtime.
- `steps[].next`: downstream step IDs used to build the DAG. Logic nodes may choose a subset at runtime.
- `steps[].retry`: optional retry policy with `attempts` and `backoff_ms`.
- `steps[].timeout_ms`: optional per-step execution timeout in milliseconds.

## Design notes

- YAML remains the single source of truth for workflows.
- The engine validates trigger configuration before execution and compiles the steps into a DAG.
- Condition and switch nodes can route to specific downstream steps; non-selected branches are recorded as skipped.
- Cron triggers persist their next-run timestamps in SQLite; webhook triggers require an environment-managed shared secret.
- Approval and manual-input nodes persist pending human tasks in SQLite and can be resumed through the HTTP API.
- External connector nodes are discovered from manifest files and executed either as subprocesses or Extism-backed WASM plugins.
- The visual editor loads, saves, duplicates, deletes, and manually runs workflows through the engine API under `/api/workflows`.
- Run history, run detail, and filtered execution logs are exposed under `/api/runs`.
- The engine exports Prometheus-style metrics at `/metrics`.
- Step payloads returned by the run-detail API are redacted by default and can be hidden entirely with `ACSA_LOG_PAYLOADS=0`.
- Run and log retention can be configured with `ACSA_RUN_RETENTION_DAYS` and `ACSA_LOG_RETENTION_DAYS`.
- Workflow API validation rejects inline secrets for secret-like field names (`secret`, `token`, `password`, `api_key`, `access_key`, `private_key`) and for string values matching common credential patterns (for example `token=...`, `key=...`, `Bearer ...`) or long base64-like/high-entropy tokens (typically 24+ characters). Use environment references (`secret_env`, plus accepted aliases `secrets_env` and `token_env`) instead.
