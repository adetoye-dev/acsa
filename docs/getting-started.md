# Getting Started

## Engine prerequisites

- Rust toolchain with `cargo`
- SQLite available through the bundled Rust dependency stack

## UI prerequisites

- Node.js 22+
- npm 11+ or pnpm 10+

## Run the Phase 2 CLI

```bash
cargo run -p acsa-core -- workflows/hello.yaml
```

Expected behavior:

- reads the YAML file
- validates the baseline schema
- prints the workflow name, trigger type, and step count

## Run the Phase 2 UI

```bash
cd ui
npm install
npm run dev
```

The current UI is a foundation shell for the visual builder. It includes a workflow explorer, a React Flow canvas, a node inspector, and top-bar actions that will later connect to the engine APIs.

## Security reminders

- keep secrets out of workflow files
- use environment variables or secret managers
- do not commit local `.env` files
- treat logs as potentially sensitive and redact before persistence
