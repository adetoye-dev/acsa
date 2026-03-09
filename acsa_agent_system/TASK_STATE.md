# Acsa Task State

Last updated: 2026-03-07

## Current Status

- Project stage: Core engine complete
- Current phase: Phase 3 complete, Phase 4 pending review gate
- Coding status: Repository foundation, workflow engine, SQLite persistence, and manual CLI execution are in place
- Approval status: Waiting for user approval before starting Phase 4

## Completed This Session

- Read:
  - `acsa_agent_system/structured_system.md`
  - `acsa_agent_system/prompts.md`
  - `acsa_agent_system/AGENT_RULES.md`
  - `acsa_blueprint/01_overview.md`
  - `acsa_blueprint/02_foundation.md`
  - `acsa_blueprint/03_engine.md`
  - `acsa_blueprint/04_nodes.md`
  - `acsa_blueprint/05_connectors.md`
  - `acsa_blueprint/06_ui.md`
  - `acsa_blueprint/07_observability.md`
  - `acsa_blueprint/08_distribution.md`
  - `acsa_blueprint/09_release.md`
  - `acsa_blueprint/10_security.md`
- Produced the initial implementation plan
- Mapped the target repository structure
- Identified milestones and key risks
- Initialized Git for the repository
- Added Apache-2.0 licensing, notice file, README, and root workspace files
- Created the top-level repository structure and baseline docs
- Bootstrapped the Rust workspace and `acsa-core` crate
- Added workflow models, validation, tests, and a sample CLI loader
- Scaffolded the Next.js UI with a React Flow editor shell
- Added CI checks for Rust and UI verification
- Installed local dependencies needed to verify Phase 2
- Removed unused vulnerable `sqlx` and `extism` dependencies from the Phase 2 crate manifest and deferred them to the execution/plugin phases
- Ran formatting, tests, lint, build, and audit checks for the completed foundation
- Reintroduced `sqlx` with SQLite-only features for Phase 3 persistence
- Implemented workflow directory loading, DAG planning, cycle detection, and execution orchestration
- Added bounded concurrent execution, retry handling, and per-step timeout control
- Added SQLite-backed `runs`, `step_runs`, and `logs` tables with restart cleanup
- Extended the CLI with `validate`, `list`, and `run` commands
- Added an executable sample DAG workflow at `workflows/manual-demo.yaml`
- Ran Rust tests, clippy, CLI execution checks, and a clean Cargo audit for the Phase 3 engine

## Current Repository Baseline

- Repository is initialized as Git
- Top-level implementation directories now exist: `core/`, `ui/`, `connectors/`, `workflows/`, `docs/`, and `examples/`
- Rust workspace and UI dependency lockfiles have been generated
- `workflows/hello.yaml` is the baseline sample workflow used by the CLI
- `workflows/manual-demo.yaml` is the baseline executable DAG sample used by the engine CLI
- Phase 2 CI workflow is present under `.github/workflows/ci.yml`

## Next Action

If the user approves, begin Phase 4 only:

1. Add built-in trigger implementations for cron, webhook, and manual dispatch
2. Implement logic and integration nodes such as `if`, `switch`, `parallel`, and `http_request`
3. Add the first AI primitives behind safe provider abstractions
4. Extend parameter validation and secret-redaction behavior per node family
5. Stop and ask for review before Phase 5

## Non-Negotiable Execution Rules

- Follow the blueprint phases sequentially
- Do not skip phases
- Do not start the next phase without explicit user approval
- After each phase, provide:
  - summary of work
  - files created/modified
  - test results
  - request for approval
- Prioritize:
  - developer experience
  - security
  - performance
  - modular architecture
  - extensibility

## Security Constraints

- Apache-2.0 licensing
- No secrets committed to the repository
- Validate YAML, JSON, manifests, and external inputs
- Sandbox plugins
- Enforce memory/time limits
- Redact sensitive logs
- Avoid unsafe Rust unless clearly justified

## Risk Mitigation Plan

- Scope risk
  - Keep each phase narrowly aligned to the blueprint
  - Do not pull later-phase features forward
  - Treat non-blueprint enhancements as out of scope until the MVP path is complete

- Plugin isolation risk
  - Prefer WASM connectors for untrusted extensions
  - Apply manifest-driven timeout and memory limits
  - Pass only explicitly allowed environment variables to connectors
  - Validate connector JSON input/output strictly
  - Add tests for malformed, hanging, and over-limit connectors

- Schema evolution risk
  - Introduce a versioned workflow schema early
  - Separate raw YAML parsing from validated internal models
  - Add normalization and validation boundaries before execution
  - Preserve room for future migrations without breaking existing workflows

- Concurrency and persistence risk
  - Use transactional SQLite writes for run and step state
  - Bound parallelism with explicit concurrency controls
  - Make retry and failure transitions deterministic
  - Add integration tests for branching, retries, partial failure, and restart recovery

- UI local-first risk
  - Make the engine API the primary integration path
  - Keep direct browser file access optional
  - Preserve YAML as the single source of truth
  - Avoid making browser-specific filesystem capabilities a hard dependency

- External integration risk
  - Use adapters for HTTP, database, and AI provider integrations
  - Enforce default timeout, retry, and rate-limit controls
  - Use mocks in CI instead of live credentials
  - Keep secrets out of workflow YAML and redact sensitive logging by default

- Distribution risk
  - Validate packaging assumptions before the release phase
  - Keep binary, UI, and container packaging loosely coupled
  - Add build verification across supported targets
  - Check artifact size, version metadata, and reproducibility before publishing

## Phase Gate Rule

If a phase introduces material risk without a corresponding validation or mitigation control, that phase is not complete and should not be advanced.

## Resume Protocol For Future Sessions

Before doing work:

1. Read this file
2. Confirm the current phase and approval state
3. Continue from the `Next Action` section
4. Update this file at the end of the session or when phase status changes
