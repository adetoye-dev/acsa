# Acsa Task State

Last updated: 2026-03-11

## Current Status

- Project stage: Blueprint implementation complete through security hardening
- Current phase: Phase 10 complete, review gate pending
- Coding status: Blueprint implementation is complete, and post-blueprint UX polish is underway in the UI
- Approval status: User-approved follow-on frontend improvements are in progress

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
- Added the observability module for tracing, redaction, metrics export, and retention policy handling
- Added paginated run-history, run-detail, and filtered log queries on top of the SQLite run store
- Added Prometheus-style metrics export at `/metrics`
- Added background retention cleanup driven by `ACSA_LOG_RETENTION_DAYS` and `ACSA_RUN_RETENTION_DAYS`
- Added the UI run-history panel with metrics cards, run filtering, step timelines, and log search
- Added observability documentation for metrics, log redaction, retention, and UI execution views
- Verified the observability endpoints and UI-facing run history APIs against a live Phase 7 server session
- Added release-profile tuning at the workspace level plus embedded binary version metadata
- Added a `version` command and `--version` flag to the CLI
- Configured the Next.js app for standalone production output
- Added Docker packaging, Docker Compose, and Kubernetes deployment assets under `deploy/`
- Added installer and local release-packaging scripts under `scripts/`
- Added Homebrew and Scoop release manifests under `packaging/`
- Added a tagged release workflow for binary artifacts, checksums, UI bundles, and container publishing
- Added self-hosting documentation for binary, Docker, and Kubernetes deployment paths
- Narrowed the `reqwest` feature set and updated `quinn-proto` to `0.11.14` to clear the new HTTP-stack RustSec advisory
- Added a user guide, API reference, connector development guide, UI manual, and architecture diagrams (see `docs/architecture.md`)
- Added CONTRIBUTING, Code of Conduct, support guidance, roadmap, changelog, contributors list, release playbook, trademark notice, and dependency license snapshot
- Added GitHub issue templates and a pull request template for public collaboration
- Hardened webhook triggers with optional HMAC SHA-256 signature verification in addition to shared-secret headers
- Tightened workflow trigger validation to accept signed webhooks and reject misconfigured signature fields
- Hardened integration nodes to reject inline sensitive HTTP headers and inline PostgreSQL DSNs, and to bound HTTP/file payload sizes
- Hardened connector manifests and runtimes with explicit timeout requirements, env allowlists, host/path restrictions, and a default-off WASM runtime gate
- Added plain-text log redaction for bearer tokens, common credential key/value patterns, and PostgreSQL DSN passwords
- Added a dedicated `docs/security.md` guide plus a checked-in `scripts/security-audit.sh` command for the accepted upstream Extism/Wasmtime audit exceptions
- Fixed the UI lint workflow so `npm run lint` works on a clean checkout without requiring a prior Next build
- Verified Phase 10 with `cargo fmt --all`, `cargo test --workspace`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`, `./scripts/security-audit.sh`, `npm run lint`, and `npm run build`
- Moved workflow-editor state and observability state into dedicated Zustand stores to reduce `editor-shell.tsx` local state sprawl
- Added `zustand` as a direct UI dependency and removed the selector deprecation warning by switching to `useShallow`
- Verified the Zustand refactor with `npm run lint` and `npm run build`
- Added a local connector manager UI for listing installed connectors, surfacing invalid manifests, scaffolding new connectors, and running sample manifest tests from the editor
- Added engine HTTP endpoints for connector inventory, connector scaffolding, and connector sample testing
- Made connector inventory resilient so invalid manifests no longer block valid connectors from loading into the catalog
- Verified the connector UX work with `cargo fmt --all`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`, `cargo test --workspace`, `npm run lint`, and `npm run build`

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
- Phase 7 observability endpoints are live under `/metrics` and `/api/runs`
- The UI now includes a run-history panel backed by the engine observability APIs
- Phase 8 deployment assets now live under `deploy/`
- Phase 8 release/install manifests now live under `scripts/`, `packaging/`, and `.github/workflows/release.yml`
- Phase 9 public documentation now lives under `docs/` plus root community files such as `CONTRIBUTING.md` and `RELEASING.md`
- Phase 10 security documentation now includes `docs/security.md`
- Phase 10 dependency review is enforced through `scripts/security-audit.sh` and the CI workflow
- The UI now includes a connector manager panel backed by `/api/connectors`

## Next Action

Continue post-blueprint UI polish only when explicitly requested. Current likely follow-ons:

- add a real command palette
- iterate on connector install/import UX beyond local scaffolding and sample tests
- revisit edge-level execution overlays only if the user wants them back

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

- `extism 1.13.0` still pulls the following upstream Wasmtime advisories:
  - `RUSTSEC-2026-0020`
  - `RUSTSEC-2026-0021`
  - `RUSTSEC-2026-0006`
- `fxhash 0.2.1` is still reported as unmaintained through the same Wasmtime dependency tree:
  - `RUSTSEC-2025-0057`
- These IDs are explicitly carried in `scripts/security-audit.sh` so CI stays green while the residual risk remains visible in version control and `docs/security.md`.
- Runtime mitigations in place today:
  - WASM connectors are disabled unless `ACSA_ENABLE_WASM_CONNECTORS=1`
  - connector manifests enforce strict timeout and memory ceilings before execution
  - subprocess connectors keep the safer path for trusted local integrations
- Remaining follow-up after the blueprint:
  - upgrade `extism` as soon as it releases a patched Wasmtime chain
  - remove the temporary audit exceptions after that upgrade
  - evaluate portable OS-level memory caps for subprocess connectors without resorting to unsafe Rust

## Resume Protocol For Future Sessions

Before doing work:

1. Read this file
2. Confirm the current phase and approval state
3. Continue from the `Next Action` section
4. Update this file at the end of the session or when phase status changes
