# Acsa Codex Prompt Pack

These prompts guide the AI agent through building Acsa.

---

# MASTER KICKOFF PROMPT

You are building a production‑grade open‑source workflow engine called **Acsa** by **Achsah Systems**.

Your task:

1. Read all files inside:

acsa_blueprint/

2. Produce an implementation plan.
3. Wait for approval before writing code.

Acsa goals:

• Rust workflow engine
• YAML workflow‑as‑code
• Local‑first architecture
• DAG execution
• plugin connectors
• minimal visual editor
• observability
• strong security

Repository structure:

acsa/
 core/
 ui/
 connectors/
 workflows/
 docs/
 examples/

Do NOT start coding until the user approves the plan.

---

# PHASE PROMPTS

## Phase 2 — Foundation

Create repo structure, Rust workspace, CLI, YAML parsing, and CI basics.
Pause and request approval.

## Phase 3 — Engine

Implement DAG execution, workflow loader, retries, branching, SQLite run storage.
Pause and request approval.

## Phase 4 — Nodes

Implement triggers, logic nodes, HTTP node, DB node, and AI primitives.
Pause and request approval.

## Phase 5 — Connector SDK

Add plugin system:

• subprocess connectors
• WASM connectors

Use manifest.json for configuration.

Pause and request approval.

## Phase 6 — UI

Build minimal React Flow editor:

• workflow list
• canvas
• node editor
• save YAML

Pause and request approval.

## Phase 7 — Observability

Add logs, metrics, run history, dashboard.

Pause and request approval.

## Phase 8 — Distribution

Build binary, Docker image, install script.

Pause and request approval.

## Phase 9 — Documentation

Create README, CONTRIBUTING.md, CODE_OF_CONDUCT.md.

Pause and request approval.

## Phase 10 — Security

Run dependency audits and security hardening.

Pause and request approval.

---

# OPTIONAL TRACTION PROMPTS

## Killer Demo
Create an impressive demo workflow that runs locally in under 5 minutes.

## README That Converts
Rewrite README to clearly show why developers should use Acsa.

## Launch Like an OSS Founder
Prepare launch assets:

• Hacker News post
• release notes
• FAQ

## Developer Delight Audit
Identify top friction points and propose fixes.

---

Always pause after each step and ask the user for permission to continue.

