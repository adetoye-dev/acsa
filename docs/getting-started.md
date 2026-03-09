# Getting Started

## Engine prerequisites

- Rust toolchain with `cargo`
- SQLite available through the bundled Rust dependency stack

## UI prerequisites

- Node.js 22+
- npm 11+ or pnpm 10+

## Run the Current CLI

```bash
cargo run -p acsa-core -- validate workflows/hello.yaml
cargo run -p acsa-core -- list workflows
cargo run -p acsa-core -- run workflows/conditional-demo.yaml --db ./acsa.db
ACSA_WEBHOOK_SECRET=YOUR_SECRET_HERE cargo run -p acsa-core -- serve workflows --db ./acsa.db --port 3001
cargo run -p acsa-core -- connector-test examples/process-connector/manifest.json --inputs examples/process-connector/sample-input.json
```

Expected behavior:

- validates workflow files and prints the execution order
- lists YAML workflows from the `workflows/` directory
- manually executes DAG workflows and writes run history to SQLite
- serves cron and webhook triggers over HTTP while recording next-run state
- exposes `/human-tasks` and `/human-tasks/{task_id}/resolve` for pending human-review steps
- exposes `/api/workflows` and `/api/node-catalog` for the visual editor
- runs connector manifests locally for subprocess and WASM development

## Run the Phase 6 UI

```bash
ACSA_WEBHOOK_SECRET=YOUR_SECRET_HERE cargo run -p acsa-core -- serve workflows --db ./acsa.db --port 3001
cd ui
npm install
npm run dev
```

The current editor is live against the engine API. It includes:

- workflow inventory, create, duplicate, delete, and load flows
- a React Flow canvas backed by the workflow YAML object in memory
- a node inspector for trigger settings, step ids, types, retry/timeout metadata, and YAML parameters
- save and manual run actions
- a human-task inbox for resolving persisted approval and manual-input gates

The Next.js app proxies `/engine/*` to `http://127.0.0.1:3001/*` by default. If the engine runs on a different address, set `ACSA_ENGINE_URL` before `npm run dev`.

Example:

```bash
cd ui
ACSA_ENGINE_URL=http://127.0.0.1:3010 npm run dev
```

## Workflow samples

- `workflows/hello.yaml`: cron-triggered validation sample
- `workflows/manual-demo.yaml`: manual DAG sample for local execution
- `workflows/conditional-demo.yaml`: manual branching sample using the `condition` node
- `workflows/webhook-demo.yaml`: authenticated webhook sample for `acsa-core serve`
- `workflows/approval-demo.yaml`: resumable approval sample that pauses until a reviewer responds

## Webhook example

```bash
curl \
  -X POST http://127.0.0.1:3001/hooks/incoming-review \
  -H "content-type: application/json" \
  -H "x-acsa-webhook-token: YOUR_SECRET_HERE" \
  -d '{"priority":"urgent","ticket_id":"INC-1024"}'
```

## Human Task Example

```bash
# Terminal 1: Start the HTTP server
ACSA_WEBHOOK_SECRET=YOUR_SECRET_HERE cargo run -p acsa-core -- serve workflows --db ./acsa.db --port 3001

# Terminal 2: Run the workflow
cargo run -p acsa-core -- run workflows/approval-demo.yaml --db ./acsa.db

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

## Security reminders

- keep secrets out of workflow files
- use environment variables or secret managers
- the workflow API rejects inline values for secret-like fields such as `secret`, `token`, and `password`; use `*_env` or `secrets_env` references instead
- do not commit local `.env` files
- treat logs as potentially sensitive and redact before persistence
