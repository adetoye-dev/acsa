# Phase 2: Foundation and Repository Setup

This phase establishes the foundation of the Acsa project.  It covers
repository structure, licensing, tooling, and initial code scaffolding.

## 1. Create the Repository and Apply License

1. **Initialize version control.**  Create a new Git repository for the
   project.  All work should be committed with clear messages.  Use a
   `.gitignore` that excludes build artifacts (e.g., `target/`, `node_modules/`,
   `.DS_Store`, compiled WASM files, etc.).

2. **Add the license.**  Copy the Apache 2.0 license text into a file named
   `LICENSE` at the root of the repository.  This license grants broad rights
   to use, modify, and distribute the software【18727317909497†L1723-L1741】.  Do not
   add additional clauses that would restrict commercial use.

3. **Add a README.**  Write a high‑level README (this will be separate from
   the blueprint) explaining what Acsa is, its goals, and how to get started.

## 2. Define the Directory Structure

Organize the repository to separate the core engine, the UI, connectors, and
documentation.  Use the following structure:

```
acsa/
├─ core/            # Rust execution engine
│  ├─ src/
│  │  ├─ main.rs    # CLI entry point
│  │  ├─ engine.rs  # Workflow execution logic
│  │  ├─ nodes/     # Built‑in nodes
│  │  └─ models.rs  # YAML/JSON data structures
│  └─ Cargo.toml
├─ ui/              # Visual builder (React/Next.js)
├─ connectors/      # Third‑party connectors (subprocess or WASM)
├─ workflows/       # User‑authored workflow YAML files
├─ docs/            # Documentation (markdown)
└─ examples/        # Sample workflows and connectors
```

Create these directories and commit them.  Empty directories should include
placeholder `.gitkeep` files to ensure they appear in the repository.

## 3. Set Up the Rust Engine

1. **Initialize a Cargo workspace.**  In the `acsa/` root, create a
   `Cargo.toml` with a `[workspace]` section.  Add `core` as a member.  This
   will allow future crates (e.g., shared libraries) to be added easily.

2. **Create `core/Cargo.toml`.**  Define the Rust crate with the following
   dependencies.  Use specific versions where possible:

   ```toml
   [package]
   name = "acsa-core"
   version = "0.1.0"
   edition = "2021"

   [dependencies]
   tokio = { version = "1", features = ["full"] }
   serde = { version = "1.0", features = ["derive"] }
   serde_yaml = "0.9"
   petgraph = "0.6"
   extism = "1.0"      # WebAssembly runtime
   sqlx = { version = "0.7", features = ["runtime-tokio", "sqlite"] }
   reqwest = { version = "0.12", features = ["json", "rustls-tls"] }
   thiserror = "1.0"
   ```

3. **Bootstrap `main.rs`.**  Write a small CLI program that reads a YAML
   workflow file from disk (e.g., `workflows/hello.yaml`), parses it into a
   `Workflow` struct using Serde, and prints the workflow name.  Use
   asynchronous execution via `tokio::main` even if the initial example does
   nothing concurrently.  This will validate that dependencies are set up
   correctly.

4. **Define data models.**  In `models.rs`, create Rust structs that match the
   YAML schema.  At minimum define:
   
   ```rust
   use serde::{Deserialize, Serialize};

   #[derive(Debug, Serialize, Deserialize)]
   pub struct Workflow {
       pub name: String,
       pub trigger: Trigger,
       pub steps: Vec<Step>,
   }

   #[derive(Debug, Serialize, Deserialize)]
   pub struct Trigger {
       pub r#type: String,
       #[serde(flatten)]
       pub details: serde_yaml::Value,
   }

   #[derive(Debug, Serialize, Deserialize)]
   pub struct Step {
       pub id: String,
       pub r#type: String,
       pub params: serde_yaml::Value,
   }
   ```

   These generic structures will be expanded in later phases.  The engine will
   eventually map `r#type` to concrete node implementations.

5. **Guardrails for code quality.**  Enable `#![deny(warnings)]` at the top of
   `main.rs` and other modules.  Configure `cargo clippy` in CI to enforce
   linting rules.  Add a `rustfmt.toml` file to maintain consistent
   formatting.

## 4. Set Up the Visual Builder Skeleton

1. **Initialize a Next.js app.**  Within the `ui/` directory run
   `npx create-next-app@latest` or `pnpm create next-app` to scaffold a React
   project.  Use TypeScript.  Delete unnecessary boilerplate pages and keep
   the structure minimal.

2. **Add dependencies.**  Install `react-flow` for the canvas editor,
   `axios` for API calls to the engine, and `tailwindcss` for styling.  Later
   phases will implement the actual editor.

3. **Local server configuration.**  Configure Next.js to run on a local port
   (e.g., 3000).  The UI should interact with the engine via HTTP if running
   concurrently, or read/write YAML files directly when the engine is not
   running.

## 5. Documentation and Examples

1. **Write docs.**  Create a `docs/` folder with Markdown pages for
   architecture decisions, design rationale, and tutorials.  Include a doc
   outlining the YAML workflow schema with examples.

2. **Provide sample workflows.**  Add a `workflows/hello.yaml` file that
   defines a trivial workflow with a cron trigger and a single HTTP request
   node.  This will be executed in the core engine as a sanity check.

## 6. Security and Compliance Guardrails

1. **No secrets in repo.**  Never commit API keys or secrets.  Instruct
   users to provide sensitive values via environment variables or external
   secret managers.

2. **License compliance.**  Ensure every source file contains an
   Apache 2.0 header comment.  Do not copy code from incompatible licenses.

3. **Dependency auditing.**  Add a workflow (e.g., GitHub Actions) to run
   `cargo audit` and `npm audit` on every commit.  If vulnerabilities are
   found, the build should fail until they are addressed.

4. **Contribution guidelines.**  Create a `CONTRIBUTING.md` later in the
   release phase that explains how to submit patches, sign commits, and agree
   to a Developer Certificate of Origin (DCO).

After completing this phase, you should have a functioning repository with a
basic CLI program that reads workflow YAML files, a stub UI, and clear
documentation.  Commit all work with detailed messages and proceed to the
engine implementation phase.
