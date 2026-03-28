# User Guide

## What Acsa is

Acsa is an app-first workflow automation product with a Rust execution runtime and a web UI for building, running, and debugging automations. Workflows, credentials, and execution history live in the app. YAML remains available as an editable representation inside the product.

## Install paths

Choose one of these paths:

- Source:
  - `cargo run -p acsa-core -- --version`
  - `cd ui && npm run dev`
- Release binary:
  - `./scripts/install.sh`
- Local release bundle:
  - `./scripts/package-release.sh`
- Container:
  - `docker compose -f deploy/docker-compose.yml up --build`

See [self-hosting.md](../dev/self-hosting.md) for deployment details.

## Core concepts

- Workflow:
  - An app-managed automation with `version`, `name`, `trigger`, and `steps`.
- Trigger:
  - Starts a workflow. Supported types are `manual`, `cron`, and `webhook`.
- Step:
  - A node execution unit. Steps have an `id`, `type`, `params`, and `next`.
- Run:
  - One execution of a workflow.
- Human task:
  - A persisted approval or manual-input checkpoint that pauses execution until resolved.
- Connector:
  - An app-managed integration asset implemented as a subprocess or WASM plugin.

## Starting the engine

Validate and inspect the sample workflows:

```bash
cargo run -p acsa-core -- validate workflows/hello.yaml
cargo run -p acsa-core -- list workflows
```

Run a workflow directly:

```bash
# Requires the demo env vars shown in README.md
cargo run -p acsa-core -- run workflows/ai-news-intelligence-demo.yaml --db ./acsa.db
```

Start the HTTP server for triggers, the UI, and observability:

```bash
ACSA_WEBHOOK_SECRET=change-me \
cargo run -p acsa-core -- serve workflows --db ./acsa.db --port 3001
```

## Building workflows

Minimal manual workflow:

```yaml
version: v1
name: manual-demo
trigger:
  type: manual
steps:
  - id: capture_input
    type: constant
    params:
      value:
        message: "hello from Acsa"
    next: []
```

Guidelines:

- Keep `id` values stable. They are used in run history and resume flows.
- Model branching with `condition` or `switch`.
- Use `retry` and `timeout_ms` for networked or flaky steps.
- Keep secrets in environment variables, not inline in YAML.
- Treat connector outputs as contracts. Validate required output fields early.

Use the studio for normal editing:

- `Canvas` for step layout and configuration
- `YAML` for direct editing inside the app
- `Executions` for debugging runs

For the full schema, see [workflow-schema.md](../dev/workflow-schema.md).

## Working with triggers

- `manual`
  - Best for UI-driven runs and testing.
- `cron`
  - Best for scheduled jobs and recurring maintenance tasks.
- `webhook`
  - Best for inbound events from external systems. Requires a shared secret via environment variable.

Webhook example:

```yaml
trigger:
  type: webhook
  path: /hooks/incoming-review
  secret_env: ACSA_WEBHOOK_SECRET
```

## Using built-in nodes

Available node families:

- Logic:
  - `noop`, `constant`, `condition`, `switch`, `loop`, `parallel`
- Integration:
  - `http_request`, `database_query`, `file_read`, `file_write`
- AI:
  - `llm_completion`, `classification`, `extraction`, `embedding`, `retrieval`
- Human:
  - `approval`, `manual_input`

Practical guidance:

- Use `http_request` for external APIs with explicit timeouts and retries.
- Use `database_query` for parameterized SQL against supported connection strings.
- Use `file_write` for local artifacts inside the allowed data directory.
- Use `approval` for gated rollouts, escalations, or compliance review.

## Tutorials

### Daily report workflow

Goal:
Fetch a status endpoint every morning and write a local report.

Recommended shape:

1. `cron` trigger
2. `http_request` step to fetch source data
3. `file_write` step to persist the result
4. Optional `approval` step if a reviewer must confirm the report

### Support queue routing

Goal:
Accept inbound webhook events and route urgent tickets for escalation.

Recommended shape:

1. `webhook` trigger
2. `condition` step on `body.priority`
3. `constant` or connector step for the urgent lane
4. `constant` or connector step for the standard lane
5. Optional `approval` step before final action

Sample:
[webhook-demo.yaml](../examples/workflow-samples/webhook-demo.yaml)

### AI-assisted response drafting

Goal:
Classify inbound text, retrieve context, and draft a response.

Recommended shape:

1. `manual` or `webhook` trigger
2. `classification` step to identify intent
3. `retrieval` step for context lookup
4. `llm_completion` step for the draft
5. `manual_input` or `approval` step before sending downstream

## Working in the app

The app supports:

- workflow creation, duplication, rename, and deletion
- drag-based canvas editing
- direct YAML editing inside the studio
- connector install/setup from the Connectors page
- credentials management from the Credentials page
- pending human-task approvals
- execution history, logs, and metrics

See [ui-manual.md](./ui-manual.md) for the complete UI walkthrough.

## Troubleshooting

- Workflow save rejected:
  - Check for invalid workflow ids or inline secret-like values.
- Webhook calls rejected:
  - Verify `ACSA_WEBHOOK_SECRET` and the request header value.
- Run paused unexpectedly:
  - Check `/human-tasks` or the UI inbox for pending approval or manual input.
- Connector execution failed:
  - Check required credentials, connector setup, required outputs, and run `connector-test` on the connector source bundle if needed.
- Logs missing payloads:
  - Confirm `ACSA_LOG_PAYLOADS` is not set to `0`.
- Old runs disappeared:
  - Check `ACSA_RUN_RETENTION_DAYS` and `ACSA_LOG_RETENTION_DAYS`.

## Next references

- [api-reference.md](../dev/api-reference.md)
- [connector-development.md](../dev/connector-development.md)
- [observability.md](../dev/observability.md)
- [self-hosting.md](../dev/self-hosting.md)
