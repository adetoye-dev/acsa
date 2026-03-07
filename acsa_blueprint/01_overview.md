# Phase 1: Project Overview and Guiding Principles

This document explains **why** Acsa is being built, what it will accomplish,
and the core principles that guide its design.  Share this overview with the
AI agent so it understands the north star before writing any code.

## 1. Objectives

1. **True open source.**  Many automation tools advertise themselves as
   source‑available but impose commercial restrictions.  n8n’s
   “Sustainable Use License” prohibits external commercial use and is not
   approved by the Open Source Initiative【18727317909497†L1723-L1741】.  Our
   engine will be released under the **Apache 2.0** license, similar to other
   successful alternatives like Activepieces (MIT‑licensed)【810363192205246†L62-L136】.  This gives developers full freedom to use,
   embed, and modify the software.

2. **Developer‑first design.**  The tool should feel like a CLI utility rather
   than a heavyweight platform.  Workflows live as plain YAML files under
   version control, and the engine watches the file system for changes.  Git
   becomes your deployment pipeline: commit a new workflow, push, and the
   engine reloads it automatically.

3. **Local‑first execution.**  Workflows must run reliably on a developer’s
   laptop without Docker or large dependencies.  A Rust binary can idle at
   under 50 MB of RAM while delivering high throughput【134737321031039†L79-L84】.
   The engine should compile into a single static binary that runs on
   Linux/macOS/Windows, and optionally in WebAssembly for edge deployments.

4. **Agentic AI orchestration.**  Traditional automation tools model workflows
   as linear sequences.  Modern AI agents require loops, state machines, and
   human approval steps.  The engine will support iterative agent execution,
   vector store retrieval, and dynamic branching from the outset.  It will
   also expose AI primitives (LLM calls, classification, extraction) as
   first‑class nodes.

5. **Extensible connector ecosystem.**  The platform must invite
   contributions.  Developers should be able to write connectors in any
   language.  We will support two extension models:

   - **Subprocess connectors:** drop a script into a folder with a manifest and
     the engine runs it, passing JSON via stdin/stdout.  This is quick for
     Python or Bash scripts.
   - **WebAssembly connectors:** compile code to WASM and run it in an
     extism‑powered sandbox.  This allows high performance while isolating
     untrusted code.

6. **Security and privacy by design.**  Workflows often handle sensitive data.
   The engine must isolate connectors from the host environment, restrict
   filesystem and network access, and ensure secrets are never logged.  We
   adopt the principle of least privilege and encourage secret management via
   environment variables or encrypted stores.

7. **Community and documentation.**  A healthy open‑source project needs
   comprehensive docs, examples, and contribution guidelines.  The final
   release phase will include a detailed README, API reference, code of
   conduct, and guidance on writing new connectors.

## 2. Deliverables of This Blueprint

The blueprint folder contains markdown files for each stage of the project.
Each file explains the tasks, provides starter code or examples, and lists
guardrails to ensure security and maintainability.  The phases are ordered
intentionally; complete them sequentially:

1. **02_foundation.md** – set up the repository, tooling, and license.
2. **03_engine.md** – implement the core workflow engine in Rust.
3. **04_nodes.md** – create built‑in nodes, triggers, and basic AI steps.
4. **05_connectors.md** – design the connector SDK and plug‑in architecture.
5. **06_ui.md** – build a minimal visual editor using React/Next.js.
6. **07_observability.md** – add logging, metrics, and run history storage.
7. **08_distribution.md** – package the binary, build Docker images, and
   document local deployment.
8. **09_release.md** – prepare the project for public release with docs.
9. **10_security.md** – summarise security best practices and guardrails.

Review this overview each time you start a new phase to ensure that the work
aligns with the core objectives.