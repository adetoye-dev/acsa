# Getting Started

## Engine prerequisites

- Rust toolchain with `cargo`
- SQLite available through the bundled Rust dependency stack

## UI prerequisites

- Node.js 22+
- npm 11+ or pnpm 10+

## First success

Use these commands in order if you are trying Acsa for the first time:

```bash
# Prepare the workspace once
./scripts/bootstrap-dev.sh

# Validate the smallest workflow
cargo run -p acsa-core -- validate workflows/hello.yaml

# Validate the flagship AI news demo
cargo run -p acsa-core -- validate workflows/ai-news-intelligence-demo.yaml

# Run the built-in connector example with working defaults
cargo run -p acsa-core -- connector-test
```

If you want the full engine + UI stack immediately:

```bash
./scripts/dev-stack.sh
```

## Run the Current CLI

```bash
cargo run -p acsa-core -- validate workflows/hello.yaml
cargo run -p acsa-core -- list workflows
cargo run -p acsa-core -- --version
# Requires the demo env vars shown in README.md
cargo run -p acsa-core -- run workflows/ai-news-intelligence-demo.yaml --db ./acsa.db
ACSA_WEBHOOK_SECRET=YOUR_SECRET_HERE cargo run -p acsa-core -- serve workflows --db ./acsa.db --port 3001
cargo run -p acsa-core -- connector-test
```

Expected behavior:

- validates workflow files and prints the execution order
- lists YAML workflows from the `workflows/` directory
- manually executes DAG workflows and writes run history to SQLite
- serves cron and webhook triggers over HTTP while recording next-run state
- exposes `/human-tasks` and `/human-tasks/{task_id}/resolve` for pending human-review steps
- exposes `/api/workflows` and `/api/node-catalog` for the visual editor
- runs connector manifests locally for subprocess development
- runs WASM connector manifests only when `ACSA_ENABLE_WASM_CONNECTORS=1`

Automation-friendly variants:

```bash
cargo run -p acsa-core -- validate workflows/hello.yaml --json
cargo run -p acsa-core -- list workflows --json
cargo run -p acsa-core -- run workflows/ai-news-intelligence-demo.yaml --db ./acsa.db --json
```

## Install a packaged binary

```bash
./scripts/install.sh
acsa-core --version
```

For local packaging instead of downloading a release:

```bash
./scripts/package-release.sh
```

## Run the UI

```bash
./scripts/bootstrap-dev.sh
./scripts/dev-stack.sh
```

`dev-stack.sh` injects local webhook secrets automatically unless you override `ACSA_WEBHOOK_SECRET` or `ACSA_WEBHOOK_SIGNATURE_SECRET`.

The current editor is live against the engine API. It includes:

- workflow inventory, create, duplicate, delete, and load flows
- a React Flow canvas backed by the workflow YAML object in memory
- a node inspector for trigger settings, step ids, types, retry/timeout metadata, and YAML parameters
- save and manual run actions
- a human-task inbox for resolving persisted approval and manual-input gates
- a run history panel with metrics, run filters, step timelines, and log search

The Next.js app proxies `/engine/*` to `http://127.0.0.1:3001/*` by default. If the engine runs on a different address, set `ACSA_ENGINE_URL` before `npm run dev`.

Example:

```bash
cd ui
ACSA_ENGINE_URL=http://127.0.0.1:3010 ./node_modules/.bin/next dev --port 3010
```

## Observability Example

```bash
# Metrics
curl http://127.0.0.1:3001/metrics

# Run history
curl "http://127.0.0.1:3001/api/runs?page=1&page_size=12"

# Run detail
curl http://127.0.0.1:3001/api/runs/RUN_ID

# Run logs
curl "http://127.0.0.1:3001/api/runs/RUN_ID/logs?level=error&search=timeout"
```

Useful environment variables:

- `ACSA_LOG_PAYLOADS=0` hides step input/output payloads from run-detail responses
- `ACSA_LOG_FILE_PATH=./logs/acsa.log` mirrors redacted structured logs to a file
- `ACSA_LOG_RETENTION_DAYS=30` purges old logs
- `ACSA_RUN_RETENTION_DAYS=14` purges finished runs, step history, and related human tasks
- `ACSA_WEBHOOK_SIGNATURE_SECRET=your_hmac_key` sets the HMAC key used to verify `x-acsa-signature` for signed webhook triggers

## Workflow samples

- `workflows/hello.yaml`: cron-triggered validation sample
- `workflows/ai-news-intelligence-demo.yaml`: the UI-visible demo that builds and emails an AI news intelligence brief from live public sources
- `examples/workflow-samples/manual-demo.yaml`: legacy manual DAG sample
- `examples/workflow-samples/conditional-demo.yaml`: legacy branching sample using the `condition` node
- `examples/workflow-samples/webhook-demo.yaml`: legacy authenticated webhook sample for `acsa-core serve`
- `examples/workflow-samples/approval-demo.yaml`: legacy resumable approval sample

## Webhook example

```bash
curl \
  -X POST http://127.0.0.1:3001/hooks/incoming-review \
  -H "content-type: application/json" \
  -H "x-acsa-webhook-token: YOUR_SECRET_HERE" \
  -d '{"priority":"urgent","ticket_id":"INC-1024"}'
```

Signed webhook example:

`ACSA_WEBHOOK_SECRET` is the public shared token sent in `x-acsa-webhook-token`. `ACSA_WEBHOOK_SIGNATURE_SECRET` is the private HMAC key used to compute and verify the `sha256` signature sent in `x-acsa-signature`.

Set both before sending signed webhook requests:

```bash
export ACSA_WEBHOOK_SECRET="YOUR_SECRET_HERE"
export ACSA_WEBHOOK_SIGNATURE_SECRET="your_hmac_key"
```

```bash
body='{"priority":"urgent","ticket_id":"INC-1024"}'
signature="sha256=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$ACSA_WEBHOOK_SIGNATURE_SECRET" -binary | xxd -p -c 256)"
curl \
  -X POST http://127.0.0.1:3001/hooks/incoming-review \
  -H "content-type: application/json" \
  -H "x-acsa-webhook-token: $ACSA_WEBHOOK_SECRET" \
  -H "x-acsa-signature: $signature" \
  -d "$body"
```

## Human Task Example

```bash
# Terminal 1: Start the HTTP server
ACSA_WEBHOOK_SECRET=YOUR_SECRET_HERE cargo run -p acsa-core -- serve examples/workflow-samples --db ./acsa.db --port 3001

# Terminal 2: Run the workflow
cargo run -p acsa-core -- run examples/workflow-samples/approval-demo.yaml --db ./acsa.db

# Check pending tasks and resolve
curl http://127.0.0.1:3001/human-tasks
curl \
  -X POST http://127.0.0.1:3001/human-tasks/TASK_ID/resolve \
  -H "content-type: application/json" \
  -d '{"approved":true}'
```

## Connector Example

```bash
cargo run -p acsa-core -- connector-new sample-echo --type sample_echo --runtime process --dir ./tmp-connectors
# Test the newly created connector
cargo run -p acsa-core -- connector-test ./tmp-connectors/sample-echo/manifest.json --inputs ./tmp-connectors/sample-echo/sample-input.json
```

`connector-new` writes repo-authored connector source plus `sample-input.json`. Run or restart the app to sync that source into app-managed runtime assets.

## Container Example

```bash
docker compose -f deploy/docker-compose.yml up --build
```

For Kubernetes and release packaging details, see `docs/self-hosting.md`.

## Security reminders

- keep secrets out of workflow files
- use environment variables or secret managers
- the workflow API rejects inline values for secret-like fields such as `secret`, `token`, and `password`; use `*_env` or `secrets_env` references instead
- use `headers_env` for sensitive HTTP headers and `connection_env` for PostgreSQL DSNs
- do not commit local `.env` files
- treat logs as potentially sensitive and redact before persistence
- disable payload visibility with `ACSA_LOG_PAYLOADS=0` when log data should stay minimal
- enable WASM connectors only when required with `ACSA_ENABLE_WASM_CONNECTORS=1`
- replace placeholder checksums in `packaging/homebrew/acsa.rb` and `packaging/scoop/acsa.json` when publishing releases
