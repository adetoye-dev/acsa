# Acsa

Acsa is a production-grade, open-source workflow automation engine from Achsah Systems. It is being built as a local-first platform for YAML workflow-as-code, DAG execution, plugin-based extensibility, observability, and security-first automation.

## Phase 6 Status

This repository now contains:

- a Rust execution engine in `core/`
- a Next.js visual editor in `ui/`
- workflow definitions in `workflows/`
- documentation in `docs/`
- built-in trigger, logic, integration, AI, and human gate primitives
- workflow CRUD and manual run APIs for the editor
- a React Flow editor wired to real YAML load/save/run flows

## Product Goals

- Developer-first workflow authoring with YAML under version control
- Lightweight Rust runtime using Tokio, Serde, Petgraph, SQLx, Reqwest, and Extism
- Local-first execution model with a minimal visual editor
- Extensible connector runtime for subprocess and WASM plugins
- Observability with logs, metrics, and run history
- Security-first defaults around validation, redaction, and isolation

## Repository Layout

```text
acsa/
├─ core/
├─ ui/
├─ connectors/
├─ workflows/
├─ docs/
└─ examples/
```

## Quick Start

### Engine

Rust is required to build and run the engine.

```bash
cargo run -p acsa-core -- validate workflows/hello.yaml
cargo run -p acsa-core -- list workflows
cargo run -p acsa-core -- run workflows/manual-demo.yaml --db ./acsa.db
ACSA_WEBHOOK_SECRET=YOUR_SECRET_HERE cargo run -p acsa-core -- serve workflows --db ./acsa.db --port 3001
cargo run -p acsa-core -- connector-test examples/process-connector/manifest.json --inputs examples/process-connector/sample-input.json
```

**Note:** Generate a strong secret for production with `openssl rand -hex 32` and set it in the `ACSA_WEBHOOK_SECRET` environment variable.

The current CLI can validate workflows, list workflow files, manually execute DAG workflows, serve cron plus webhook triggers, persist and resume human review tasks, scaffold connectors, and test connector manifests locally.

### UI

Node.js 22+ is recommended for the UI.

```bash
ACSA_WEBHOOK_SECRET=YOUR_SECRET_HERE cargo run -p acsa-core -- serve workflows --db ./acsa.db --port 3001
cd ui
npm install
npm run dev
```

The Phase 6 UI now loads workflows from the engine API, edits YAML-backed workflow state, saves validated changes, starts manual runs, and resolves persisted human tasks from the editor inbox. By default the Next.js app proxies `/engine/*` to `http://127.0.0.1:3001/*`; override that with `ACSA_ENGINE_URL` if your engine runs elsewhere.

## Security Baseline

- No secrets should be committed to this repository
- Workflows should reference environment-managed secrets instead of storing raw values
- Logs must redact sensitive values
- Plugins must be sandboxed and resource-limited in later phases
- Unsafe Rust is avoided by default

## Current Engine Scope

- workflow directory loading and schema validation
- DAG planning with cycle detection
- bounded concurrent step execution
- retry-aware step execution with timeout control
- SQLite-backed run and step-attempt persistence
- SQLite-backed trigger state persistence
- persisted human task state with resumable approval and manual-input steps
- manual, cron, and webhook trigger dispatch
- workflow inventory, read, write, duplicate, delete, run, and node-catalog APIs for the UI
- logic nodes for `condition`, `switch`, `loop`, and `parallel`
- integration nodes for HTTP, database, and file access
- AI primitives for completion, classification, extraction, embedding, and retrieval
- process and WASM connector loading from `connectors/`
- connector scaffolding and local manifest testing commands
- a React Flow editor with workflow explorer, node inspector, YAML preview, and human-task inbox

## Next Milestones

1. Add observability, run history, and execution views for the editor
2. Build distribution and packaging assets
3. Complete release collateral and community-facing documentation
4. Track upstream Extism/Wasmtime security fixes and tighten connector isolation as patched versions land
