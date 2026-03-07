# Acsa

Acsa is a production-grade, open-source workflow automation engine from Achsah Systems. It is being built as a local-first platform for YAML workflow-as-code, DAG execution, plugin-based extensibility, observability, and security-first automation.

## Phase 2 Status

This repository currently contains the foundation scaffolding for:

- a Rust execution engine in `core/`
- a Next.js visual builder in `ui/`
- workflow definitions in `workflows/`
- documentation in `docs/`
- examples and connector placeholders for later phases

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
cargo run -p acsa-core -- workflows/hello.yaml
```

The Phase 2 CLI loads a workflow YAML file, validates the baseline schema, and prints a summary.

### UI

Node.js 22+ is recommended for the UI.

```bash
cd ui
npm install
npm run dev
```

The Phase 2 UI is a minimal editor shell designed to evolve into the React Flow builder described in the blueprint.

## Security Baseline

- No secrets should be committed to this repository
- Workflows should reference environment-managed secrets instead of storing raw values
- Logs must redact sensitive values
- Plugins must be sandboxed and resource-limited in later phases
- Unsafe Rust is avoided by default

## Next Milestones

1. Implement the DAG execution engine and persistence layer
2. Add built-in workflow nodes and triggers
3. Add connector runtime support for subprocess and WASM extensions
4. Add observability, packaging, and release collateral
