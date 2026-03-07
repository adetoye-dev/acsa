# Phase 4: Built‑in Nodes and AI Primitives

This phase focuses on implementing the built‑in nodes that ship with Acsa.  A
rich set of default nodes makes the engine immediately useful and serves as
examples for writing custom connectors later.

## 1. Trigger Nodes

1. **Cron trigger.**  Runs a workflow on a schedule defined by a cron
   expression.  Use the `cron` crate or implement simple parsing yourself.
   When the application starts, schedule tasks using `tokio::spawn` and
   `tokio::time::interval_at`.  Persist next‑run times in the database so
   triggers survive restarts.

2. **Webhook trigger.**  Expose an HTTP endpoint (e.g., `/hooks/{workflow}`)
   using a minimal web framework (e.g., `axum`).  When the endpoint receives
   a request, parse the body into JSON and start a new workflow run.  Use
   HMAC signatures or secret tokens to authenticate incoming requests.

3. **Manual trigger.**  A CLI command (e.g., `acsa run --workflow my.yaml`) or
   UI button that starts a workflow immediately.  Useful for testing or ad‑hoc
   runs.

All triggers produce an initial payload (often empty) that becomes the
`inputs` for the first step.

## 2. Logic Nodes

1. **If/condition.**  Evaluates an expression on the input and routes to one
   of two branches.  For example, if `amount > 100`, go to the `high_value`
   branch; otherwise, go to `low_value`.  Use a small expression evaluator
   library like `rhai` or implement basic comparisons yourself.

2. **Switch.**  Similar to `if`, but with multiple cases keyed off a value.

3. **Parallel.**  Takes a list of child steps and runs them concurrently.
   Waits for all to finish before continuing.  Respect the global concurrency
   limit.

4. **Loop.**  Allows repeating a set of steps over a list.  For example,
   iterate over an array of items and perform an HTTP call for each.  Limit
   the maximum number of iterations to avoid infinite loops.

## 3. Integration Nodes

1. **HTTP request.**  Performs a GET/POST/PUT/PATCH/DELETE request to an
   external API.  Use `reqwest` with TLS support.  Accept URL, method,
   headers, query parameters, and body as `params`.  Return the parsed JSON
   response.

2. **Database query.**  Supports Postgres and SQLite.  Accepts a SQL query and
   connection details.  Use `sqlx` and parameterized queries to avoid SQL
   injection.  Never log full query strings with sensitive data.

3. **File read/write.**  Reads from or writes to files on the local disk.
   Restrict this node to a preconfigured directory (e.g., `/data`) to prevent
   arbitrary filesystem access.  Validate file paths against a whitelist.

## 4. AI Nodes

Modern workflows often need to call large language models or other AI
services.  Provide the following primitives:

1. **LLM completion.**  Send a prompt to an LLM provider (OpenAI, Anthropic,
   etc.).  Accept model name, system prompt, user prompt template, and
   variables.  Use `reqwest` to call the provider’s API.  Support streaming
   responses for large outputs.  Expose a `max_tokens` parameter and keep
   track of token usage to avoid unexpected charges.

2. **Classification.**  Provide a class list and a text input.  Ask the
   underlying model to return the best class.  Validate that the output is
   one of the provided classes.

3. **Extraction.**  Extract structured fields from free‑form text into a
   JSON object.  Accept a schema definition.  Use careful prompt engineering
   to reduce hallucinations and validate the response against the schema.

4. **Embedding and retrieval.**  Generate vector embeddings from text and
   query a vector store.  Provide a simple in‑memory or SQLite‑based
   implementation initially; later phases can integrate with external vector
   databases.  Use these nodes to implement RAG (retrieval‑augmented
   generation) workflows.

## 5. Human‑in‑the‑Loop Nodes

1. **Approval.**  Pauses the workflow and notifies a human reviewer (e.g., via
   email or Slack).  The workflow resumes when the reviewer approves or
   rejects.  Store pending approvals in the database and implement a small
   API endpoint to receive approval decisions.

2. **Manual input.**  Similar to approval but collects structured input from
   the user.  For example, ask a manager to assign a priority to a ticket.
   The workflow resumes with the user’s input as part of the payload.

## 6. Implementation Tips

1. **Type registration.**  Create a module `nodes/mod.rs` that registers all
   built‑in nodes in a `HashMap<String, Arc<dyn Node>>`.  Inject this registry
   into the engine at startup.  Use `Arc` to share node instances across
   runs.

2. **Parameter validation.**  Each node should validate its parameters at
   runtime.  If a required parameter is missing or of the wrong type, return
   a clear error message.  Do not allow arbitrary code execution in
   parameters.

3. **Sensitive data handling.**  Nodes must not log secrets (API keys,
   passwords, personal data).  Mask sensitive fields before writing them to
   logs or the database.

4. **Rate limiting.**  For HTTP and AI nodes, implement client‑side rate
   limiting to avoid hitting external API limits.  Provide configurable
   concurrency and QPS (queries per second) limits per node or workflow.

5. **Testing.**  Write unit tests for each node, including success and failure
   paths.  Use mock HTTP servers for integration tests and simulate API
   failures.  For AI nodes, mock the provider’s API responses to avoid
   unnecessary API calls during testing.

Completing this phase will give the engine a robust set of built‑in nodes,
making Acsa immediately useful for common automation and AI workflows.
