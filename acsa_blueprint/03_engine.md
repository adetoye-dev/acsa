# Phase 3: Core Execution Engine

The execution engine is the heart of Acsa.  It loads workflows from YAML
files, constructs a directed acyclic graph (DAG) of steps, and orchestrates
their execution.  This document guides the AI agent through designing and
implementing the engine.

## 1. High‑Level Architecture

1. **Workflow loader.**  Watches the `workflows/` folder and parses every
   `.yaml` file into a `Workflow` struct defined in `models.rs`.  Validate
   required fields and emit clear error messages if a workflow is invalid.

2. **DAG construction.**  Convert a workflow into a petgraph `DiGraph`.  Each
   step becomes a node; edges represent data flow or execution order.  Use
   `petgraph::algo::toposort` to ensure the graph is acyclic and to compute
   execution order.  Detect cycles early and reject workflows that contain
   them.

3. **Execution loop.**  For each workflow run:

   - Initialize a run record in the SQLite database (`runs` table) with a
     unique ID, start timestamp, and status.
   - Evaluate the trigger.  For a cron trigger, schedule the workflow using
     Tokio’s `Interval`; for a webhook trigger, register an HTTP route via
     `warp` or `axum` (choose one framework and stick with it).
   - Traverse the nodes in topological order.  For each step, call the
     appropriate node implementation (see Phase 4).  Record input and output
     payloads in the `step_runs` table.  If a step fails, check its retry
     policy; if retries remain, wait the backoff period and retry.  Otherwise,
     mark the run as failed and stop executing downstream nodes.

   - Support branching and parallelism.  The engine should allow multiple
     successor nodes to run concurrently.  Use `tokio::spawn` to execute
     independent branches simultaneously, but limit concurrency (e.g., using
     a `Semaphore`) to prevent resource exhaustion.

   - At completion, update the run status to `success` or `failed` and record
     the end timestamp.

4. **State management.**  Persist run state to SQLite using `sqlx`.  Define
   tables for `runs`, `step_runs`, and `logs`.  Use transactions to ensure
   consistency.  Index tables on run IDs to enable efficient queries from the
   observability layer.

## 2. Node Execution Abstraction

Define a trait that all node implementations must implement.  This allows the
engine to call nodes generically without knowing their internal logic.

```rust
use async_trait::async_trait;
use serde_json::Value;

#[async_trait]
pub trait Node {
    /// Unique type identifier (e.g., "http_request", "llm", "if")
    fn type_name(&self) -> &'static str;

    /// Execute the node.  `inputs` contains outputs of upstream nodes, and
    /// `params` comes from the workflow YAML.  The function returns a JSON
    /// value that downstream nodes will receive as input.
    async fn execute(&self, inputs: &Value, params: &Value) -> anyhow::Result<Value>;
}
```

Implement a registry mapping node type strings to boxed `Node` instances.
During engine initialization, register all built‑in nodes.  When executing a
workflow, look up the step’s `type` and call the corresponding implementation.

## 3. Handling Connectors via WebAssembly

External connectors live outside the core binary.  Use the `extism` crate to
load and execute WASM plugins safely:

1. **Manifest definition.**  Each connector in `connectors/` contains a
   `manifest.json` describing the plugin name, the `.wasm` file, expected
   inputs, and outputs.  The manifest also specifies memory limits and timeouts
   for the plugin.

2. **Loading a plugin.**  At runtime, read the manifest and use
   `extism::Wasm::file()` to load the `.wasm`.  Create a `Manifest` object and
   instantiate a `Plugin` with WASI enabled (`true`) but no host functions
   initially.

3. **Executing a function.**  Call a predefined function (e.g., `execute`) in
   the WASM module, passing a JSON string as input.  Receive a JSON string
   back, parse it into a `serde_json::Value`, and return it to the engine.  If
   the plugin panics or exceeds memory/time limits, catch the error, mark the
   step as failed, and follow the retry policy.

4. **Sandboxing.**  Do not grant WASM plugins access to the host filesystem or
   network unless explicitly required.  Use extism’s limits to restrict
   memory (e.g., 64 MiB) and execution time.  Validate JSON boundaries to
   prevent injection attacks.

## 4. Error Handling and Retries

Each step should define a retry policy with the number of attempts and a
backoff strategy (e.g., exponential).  Implement a helper function that
wraps node execution with retry logic.  On failure, log the error with
context (step ID, error message, attempt number) and record it in the
database.  If the step ultimately fails, bubble the error up and mark the
workflow run as failed.

## 5. Guardrails for Safety

1. **Cycle detection.**  Always run a topological sort on the workflow graph
   before execution.  Reject workflows with cycles to avoid infinite loops.

2. **Concurrency control.**  Use a `Semaphore` or `tokio::sync::Semaphore` to
   limit the number of concurrently executing steps and prevent resource
   exhaustion.

3. **Runtime isolation.**  Run external connectors in separate OS processes or
   WASM sandboxes.  Never execute untrusted code in the same process as the
   engine.  Always validate and sanitize inputs and outputs.

4. **Timeouts.**  Set timeouts for each node execution.  If a node exceeds its
   allotted time, terminate it and treat it as a failure.  Expose sensible
   defaults (e.g., 30 seconds) but allow users to override them per step.

5. **Memory limits.**  When running WASM connectors, restrict memory
   consumption (e.g., 64 MiB).  For subprocess connectors, monitor memory
   usage and kill processes that exceed limits.

6. **Persistence consistency.**  Use transactions when inserting run and
   step‑run records.  If the engine crashes mid‑execution, on restart it should
   resume or mark incomplete runs as failed.

By the end of this phase, the AI agent should deliver a working execution
engine capable of loading YAML workflows, validating them, executing steps
according to a DAG, and storing run results.  Comprehensive tests should
cover successful runs, branching, retries, and failure scenarios.
