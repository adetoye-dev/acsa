# Architecture Overview

Acsa is structured as a local-first automation platform with clear separation between runtime concerns, workflow definitions, extension points, and the visual editing experience.

## Primary Components

- `core/`: the Rust runtime responsible for workflow loading, validation, execution, persistence, and later observability and security controls
- `ui/`: the Next.js application that provides the visual editor and run inspection views
- `connectors/`: externally packaged runtime extensions, initially placeholders for subprocess and WASM connectors
- `workflows/`: YAML workflow definitions checked into source control
- `examples/`: sample workflows and extension patterns for contributors

## Phase 2 Foundation Decisions

- YAML is the source of truth for workflow definitions
- The engine starts with strict workflow file loading and baseline validation before DAG execution is introduced
- The UI is scaffolded as a separate process so local-first usage remains possible
- Security-sensitive behavior such as connector sandboxing, rate limits, log redaction, and secret indirection are treated as first-class design requirements

## Near-Term Evolution

Phase 3 will introduce:

- DAG construction and cycle detection
- retry-aware execution orchestration
- SQLite-backed run tracking
- initial HTTP endpoints for manual execution and future UI integration

Phase 4 and later will add:

- built-in nodes and triggers
- connector SDK support
- observability primitives
- packaging and release assets
