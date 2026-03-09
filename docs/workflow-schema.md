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
  - `webhook`: requires `secret_env` and optionally `path` plus `header`.
- `steps[].id`: stable step identifier.
- `steps[].type`: node or connector type.
  - Built-in logic: `constant`, `noop`, `condition`, `switch`, `loop`, `parallel`
  - Built-in integration: `http_request`, `database_query`, `file_read`, `file_write`
  - Built-in AI: `llm_completion`, `classification`, `extraction`, `embedding`, `retrieval`
  - Built-in human gate nodes: `approval`, `manual_input`
- `steps[].params`: arbitrary parameter object for the step runtime.
- `steps[].next`: downstream step IDs used to build the DAG. Logic nodes may choose a subset at runtime.
- `steps[].retry`: optional retry policy with `attempts` and `backoff_ms`.
- `steps[].timeout_ms`: optional per-step execution timeout in milliseconds.

## Design notes

- YAML remains the single source of truth for workflows.
- The engine validates trigger configuration before execution and compiles the steps into a DAG.
- Condition and switch nodes can route to specific downstream steps; non-selected branches are recorded as skipped.
- Cron triggers persist their next-run timestamps in SQLite; webhook triggers require an environment-managed shared secret.
- Approval and manual-input nodes are available as parameter-driven gates today; a persisted asynchronous resume API is still a follow-on hardening task.
