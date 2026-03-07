# Workflow Schema

Acsa workflows are stored as YAML and will evolve under a versioned schema.

## Baseline Phase 2 shape

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

## Field reference

- `version`: schema version identifier. Phase 2 uses `v1`.
- `name`: unique human-readable workflow name.
- `trigger.type`: trigger identifier such as `manual`, `cron`, or `webhook`.
- `trigger.*`: trigger-specific properties.
- `steps[].id`: stable step identifier.
- `steps[].type`: node or connector type.
- `steps[].params`: arbitrary parameter object for the step runtime.
- `steps[].next`: optional downstream step IDs for later DAG execution.
- `steps[].retry`: optional retry policy for later execution phases.

## Design notes

- YAML remains the single source of truth for workflows.
- The engine validates schema shape before execution.
- Future phases will add richer branching, retry, approval, and connector configuration while remaining backward-compatible with `v1`.
