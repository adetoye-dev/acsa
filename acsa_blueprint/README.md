# Acsa: Open‑Source AI Workflow Infrastructure

Acsa is an open‑source, developer‑centric workflow engine designed to make it
easy to build and operate reliable automation and AI workflows.  It is the
technical foundation for **Achsah Systems**, a company focused on building the
infrastructure intelligent systems run on.

Unlike fair‑code tools such as n8n, which restrict commercial use and are not
open source under OSI guidelines【18727317909497†L1723-L1741】,
Acsa is licensed under **Apache 2.0**.  A permissive license ensures that
anyone can use the code, extend it, or even build a SaaS product on top
without worrying about steep embed fees or restrictive “Sustainable Use”
clauses.

Acsa is also designed to be **lightweight and portable**.  Where popular
automation platforms require hundreds of megabytes of RAM to run inside
Docker, a well‑tuned Rust binary can idle at under ~50 MB and deliver
industry‑leading performance【134737321031039†L79-L84】.  This allows you to run
workflows on a Raspberry Pi, a $5 VPS, or even as a Lambda function.

The following blueprint folder contains step‑by‑step instructions for an AI
agent to build Acsa from scratch.  Each markdown file describes a discrete
phase of the project, outlines tasks, and includes guardrails for security and
best practices.  Follow the phases in order to incrementally build a
production‑ready system.

File structure:

- **01_overview.md** – high‑level goals and guiding principles.
- **02_foundation.md** – repository structure, licensing, tooling.
- **03_engine.md** – core execution engine architecture and implementation.
- **04_nodes.md** – built‑in nodes, triggers, and AI components.
- **05_connectors.md** – connector SDK and plug‑in architecture (scripts & WASM).
- **06_ui.md** – building the local visual workflow editor.
- **07_observability.md** – logging, metrics, and run history.
- **08_distribution.md** – compiling, packaging, and self‑hosting.
- **09_release.md** – community release, docs, and contribution guidelines.
- **10_security.md** – security guardrails and safe coding practices.

To use this blueprint, give each markdown file to the AI agent in order and ask
it to execute the instructions.  The agent should complete all tasks in a
phase before moving to the next.  For example, after finishing the core
execution engine in phase 3, it can proceed to implementing the built‑in
nodes in phase 4.
