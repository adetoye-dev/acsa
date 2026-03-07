# Acsa AI Agent Structured Build System

This document tells a coding agent (Codex or similar) exactly how to build the Acsa project from start to finish.

## Core Principle
The agent must always:
1. Read instructions before coding
2. Work phase‑by‑phase
3. Pause for user review after each phase
4. Ask permission before continuing

## Instruction Sources
Primary architecture instructions live in:

acsa_blueprint/

Files:
01_overview.md
02_foundation.md
03_engine.md
04_nodes.md
05_connectors.md
06_ui.md
07_observability.md
08_distribution.md
09_release.md
10_security.md

Prompt instructions live in:

prompts.md

## Execution Flow

1. Run Master Kickoff Prompt
2. Agent reads entire blueprint
3. Agent proposes implementation plan
4. Wait for approval

Then execute phases sequentially:

Phase 2 → Foundation
Phase 3 → Workflow Engine
Phase 4 → Built‑in Nodes
Phase 5 → Connector SDK
Phase 6 → UI
Phase 7 → Observability
Phase 8 → Distribution
Phase 9 → Docs & Community
Phase 10 → Security Audit

After each phase the agent MUST:

• summarize work
• list files created
• show test results
• ask for approval

The agent must NOT start the next phase without approval.

## Post‑Build Prompts
After Phase 10 run the optional prompts from prompts.md:

1. Killer Demo Prompt
2. README That Converts
3. Launch Like an OSS Founder
4. Developer Delight Audit

Each must pause for review.

## Security Guardrails
Always enforce:

• Apache‑2.0 licensing
• no secrets in repo
• plugin sandboxing
• YAML validation
• timeout & memory limits
• no unsafe Rust unless justified
• redact sensitive logs

## Expected Outcome
Following this system produces:

• a lightweight Rust workflow engine
• YAML workflow‑as‑code
• plugin ecosystem
• local visual builder
• strong observability
• secure architecture

The agent should always ask:

"Would you like me to proceed to the next phase?"

before continuing.
