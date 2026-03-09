# Acsa Task State

Last updated: 2026-03-09

## Current Status

- Project stage: UI workflow APIs and visual editor integration implemented
- Current phase: Phase 6 complete, Phase 7 pending review gate
- Coding status: Persisted pause/resume, connector SDK/runtime, workflow UI APIs, and the live visual editor are in place
- Approval status: Waiting for user review before starting Phase 7

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
- Added built-in logic nodes for `condition`, `switch`, `loop`, and `parallel`
- Added integration nodes for HTTP requests, database queries, and file read/write under a restricted data directory
- Added AI primitives for completion, classification, extraction, embedding, and retrieval
- Added approval and manual-input gate nodes for parameter-driven human steps
- Updated the DAG scheduler to honor control-flow outputs and persist skipped branches
- Added trigger validation for `manual`, `cron`, and `webhook` workflows
- Added SQLite-backed trigger state tracking
- Extended the CLI with a `serve` command for cron and webhook triggers
- Implemented a trigger runtime that schedules cron workflows and serves authenticated webhook routes
- Added Phase 4 workflow samples and refreshed docs for trigger/runtime usage
- Ran Rust formatting, tests, clippy, and cargo audit for the Phase 4 implementation
- Implemented persisted async pause/resume for `approval` and `manual_input` flows
- Added SQLite-backed human task storage plus HTTP endpoints for listing and resolving pending tasks
- Added connector manifest parsing, dynamic connector registration, subprocess execution, and Extism-backed WASM execution
- Added connector CLI tooling for scaffold generation and local manifest testing
- Added connector examples for process and WASM development plus an approval workflow sample
- Ran end-to-end smoke checks for webhook execution, human-task resolution, connector scaffolding, and connector testing
- Re-ran Rust formatting, tests, clippy, and cargo audit after the Phase 5 connector work
- Added Phase 6 workflow APIs for list/read/write/duplicate/delete/run plus node catalog metadata
- Added server-side workflow id validation and inline-secret rejection for UI-originated workflow saves
- Replaced the mock React Flow shell with a live editor backed by workflow YAML objects and engine APIs
- Added create/duplicate/delete workflow flows, save/run actions, step creation, and inspector-based editing for trigger and step state
- Added a human-task inbox in the UI for persisted approval and manual-input resolution
- Added a Next.js engine proxy via `ACSA_ENGINE_URL` for local-first UI development
- Verified the new workflow APIs, manual run flow, and human-task resume path against a live Phase 6 server session

## Current Repository Baseline

- Repository is initialized as Git
- Top-level implementation directories now exist: `core/`, `ui/`, `connectors/`, `workflows/`, `docs/`, and `examples/`
- Rust workspace and UI dependency lockfiles have been generated
- `workflows/hello.yaml` is the baseline sample workflow used by the CLI
- `workflows/manual-demo.yaml` is the baseline executable DAG sample used by the engine CLI
- `workflows/conditional-demo.yaml` is the Phase 4 branching sample for manual execution
- `workflows/webhook-demo.yaml` is the Phase 4 authenticated webhook sample for the trigger server
- `workflows/approval-demo.yaml` is the persisted pause/resume sample for human approval flows
- `examples/process-connector/` is the subprocess connector sample used by `connector-test`
- `examples/wasm-plugin/` is the starter Extism/WASM connector template
- Phase 2 CI workflow is present under `.github/workflows/ci.yml`

## Next Action

If the user approves, begin Phase 7 only:

1. Add structured logs, metrics, run history APIs, and retention controls
2. Expose execution history and summary data to the UI
3. Expand observability docs and validation for redaction and retention behavior
4. Keep the observability surface aligned with the existing SQLite-backed run model
5. Stop and ask for review before Phase 8

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

## Known Follow-On Hardening

- `cargo audit` currently reports 3 upstream Wasmtime advisories through `extism 1.13.0`:
  - **RUSTSEC-2026-0020** (CVSS 6.9 Medium): Guest-controlled resource exhaustion in WASI implementations
  - **RUSTSEC-2026-0021** (CVSS 6.9 Medium): Panic adding excessive fields to `wasi:http/types.fields`
  - **RUSTSEC-2026-0006** (CVSS 4.1 Medium): Wasmtime segfault or unused out-of-sandbox load with `f64.copysign` on x86-64
  - **Assessment**: Safe to proceed to Phase 6 with runtime mitigations. All advisories are Medium severity and affect guest-controlled edge cases. WASM connectors are sandboxed and the workflow engine terminates on timeout.
  - **Immediate measures**: (1) Document the advisories in acceptance criteria, (2) Pin Wasmtime >=41.0.4 when extism updates, (3) Enforce strict timeout/memory limits in connector manifests, (4) Mark subprocess memory-caps as required follow-up for Phase 7 hardening.
- Subprocess connectors enforce timeout and JSON validation today, but OS-level memory caps remain a follow-on hardening task because the current implementation avoids unsafe/platform-specific limit code.

## Resume Protocol For Future Sessions

Before doing work:

1. Read this file
2. Confirm the current phase and approval state
3. Continue from the `Next Action` section
4. Update this file at the end of the session or when phase status changes
