# Acsa

Acsa is a production-grade, open-source workflow automation engine from Achsah Systems. It is being built as a local-first platform for YAML workflow-as-code, DAG execution, plugin-based extensibility, observability, and security-first automation.

## Phase 8 Status

This repository now contains:

- a Rust execution engine in `core/`
- a Next.js visual editor in `ui/`
- workflow definitions in `workflows/`
- documentation in `docs/`
- built-in trigger, logic, integration, AI, and human gate primitives
- workflow CRUD and manual run APIs for the editor
- a React Flow editor wired to real YAML load/save/run flows
- run history, log search, and metrics endpoints plus an execution view in the UI
- release-oriented build metadata, Docker packaging, install scripts, and self-hosting assets

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
├─ deploy/
├─ packaging/
├─ scripts/
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
cargo run -p acsa-core -- --version
cargo run -p acsa-core -- run workflows/manual-demo.yaml --db ./acsa.db
ACSA_WEBHOOK_SECRET=YOUR_SECRET_HERE cargo run -p acsa-core -- serve workflows --db ./acsa.db --port 3001
cargo run -p acsa-core -- connector-test examples/process-connector/manifest.json --inputs examples/process-connector/sample-input.json
```

**Note:** Generate a strong secret for production with `openssl rand -hex 32` and set it in the `ACSA_WEBHOOK_SECRET` environment variable.

The current CLI can validate workflows, list workflow files, print build metadata, manually execute DAG workflows, serve cron plus webhook triggers, persist and resume human review tasks, scaffold connectors, and test connector manifests locally.

The HTTP server now also exposes:

- `/metrics` for Prometheus-style metrics
- `/api/runs` for paginated run history
- `/api/runs/{run_id}` for run, step, and human-task detail
- `/api/runs/{run_id}/logs` for filtered execution logs

### Distribution

Phase 8 adds:

- `scripts/install.sh` for GitHub release installs with checksum verification
- `scripts/package-release.sh` for local artifact packaging
- `deploy/docker/Dockerfile` and `deploy/docker-compose.yml` for containerized self-hosting
- `deploy/kubernetes/` manifests for cluster deployment
- `packaging/homebrew/acsa.rb` and `packaging/scoop/acsa.json` release manifests
- `.github/workflows/release.yml` for tagged release artifacts and checksums

### UI

Node.js 22+ is recommended for the UI.

```bash
ACSA_WEBHOOK_SECRET=YOUR_SECRET_HERE cargo run -p acsa-core -- serve workflows --db ./acsa.db --port 3001
cd ui
npm install
npm run dev
```

The Phase 8 UI now loads workflows from the engine API, edits YAML-backed workflow state, saves validated changes, starts manual runs, resolves persisted human tasks from the editor inbox, and shows run history, step timelines, log search, and execution metrics. By default the Next.js app proxies `/engine/*` to `http://127.0.0.1:3001/*`; override that with `ACSA_ENGINE_URL` if your engine runs elsewhere.

The production UI is configured for Next.js standalone output so it can ship inside the Acsa container image or a packaged bundle.

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
- run history, run detail, and filtered log APIs for the UI and automation tooling
- Prometheus-style metrics export with workflow and step duration histograms
- retention controls for runs and logs
- logic nodes for `condition`, `switch`, `loop`, and `parallel`
- integration nodes for HTTP, database, and file access
- AI primitives for completion, classification, extraction, embedding, and retrieval
- process and WASM connector loading from `connectors/`
- connector scaffolding and local manifest testing commands
- a React Flow editor with workflow explorer, node inspector, YAML preview, human-task inbox, and run history panel
- release profile tuning, embedded version metadata, and a `--version` CLI surface
- standalone UI packaging plus Docker Compose, Kubernetes, installer, and release workflow assets

## Observability Controls

- `ACSA_LOG_PAYLOADS=0` disables step payload display in run detail responses
- `ACSA_LOG_FILE_PATH=/path/to/acsa.log` mirrors structured engine logs to a file
- `ACSA_LOG_RETENTION_DAYS=30` purges old logs in the background
- `ACSA_RUN_RETENTION_DAYS=14` purges old finished runs and related records

Sensitive keys and common credential patterns are redacted before log persistence. See [docs/observability.md](docs/observability.md) for the full endpoint and retention reference.

See [docs/self-hosting.md](docs/self-hosting.md) for binary installs, Docker, Kubernetes, and release packaging commands.

## Next Milestones

1. Complete release collateral and community-facing documentation
2. Harden connector isolation and release processes
3. Track upstream Extism/Wasmtime security fixes as patched versions land
