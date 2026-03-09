# Getting Started

## Engine prerequisites

- Rust toolchain with `cargo`
- SQLite available through the bundled Rust dependency stack

## UI prerequisites

- Node.js 22+
- npm 11+ or pnpm 10+

## Run the Phase 3 CLI

```bash
cargo run -p acsa-core -- validate workflows/hello.yaml
cargo run -p acsa-core -- list workflows
cargo run -p acsa-core -- run workflows/manual-demo.yaml --db ./acsa.db
```

Expected behavior:

- validates workflow files and prints the execution order
- lists YAML workflows from the `workflows/` directory
- manually executes DAG workflows and writes run history to SQLite

## Run the Phase 2 UI

```bash
cd ui
npm install
npm run dev
```

The current UI is a foundation shell for the visual builder. It includes a workflow explorer, a React Flow canvas, a node inspector, and top-bar actions that will later connect to the engine APIs.

## Workflow samples

- `workflows/hello.yaml`: cron-triggered validation sample
- `workflows/manual-demo.yaml`: manual DAG sample for local execution

## Security reminders

- keep secrets out of workflow files
- use environment variables or secret managers
- do not commit local `.env` files
- treat logs as potentially sensitive and redact before persistence
