# Phase 7: Observability, Logging, and Run History

Running workflows in production requires insight into what happened, why
something failed, and how to improve performance.  Observability is a key
differentiator between toy automation scripts and serious infrastructure.

## 1. Logging Framework

1. **Use structured logging.**  Adopt the `tracing` crate for structured
   logging in the Rust engine.  Replace `println!` with `tracing::info!`,
   `tracing::warn!`, and `tracing::error!`.  Include key fields such as
   workflow name, run ID, step ID, and attempt number in each log entry.

2. **Log sinks.**  Write logs to multiple sinks:
   - **Stdout** for local debugging.
   - **SQLite** in a `logs` table with columns `run_id`, `step_id`,
     `timestamp`, `level`, and `message`.  Limit log size by truncating very
     large messages or rotating logs.
   - **File** (optional) in `./logs/acsa.log` when the user enables file
     logging.

3. **Redaction.**  Never log secrets or personal data.  Provide helper
   functions to mask sensitive fields before logging.  For example, hide API
   keys by replacing all but the last four characters with `•`.

## 2. Metrics Collection

1. **Counters and histograms.**  Use `metrics` or `prometheus` crates to
   instrument the engine.  Record counts of workflow runs, step executions,
   failures, retries, and successes.  Measure execution time per step and
   per workflow.  Histograms help identify slow steps and bottlenecks.

2. **Export endpoints.**  Expose metrics via an HTTP endpoint (e.g.,
   `/metrics`) in Prometheus text format.  Users can scrape this endpoint
   from Grafana/Prometheus to monitor the system.  Make metrics optional via
   configuration.

## 3. Run History Database

1. **Schema design.**  Extend the SQLite schema created in Phase 3:

   ```sql
   CREATE TABLE runs (
     id            TEXT PRIMARY KEY,
     workflow_name TEXT NOT NULL,
     status        TEXT NOT NULL,
     started_at    DATETIME NOT NULL,
     finished_at   DATETIME,
     error_message TEXT
   );

   CREATE TABLE step_runs (
     id          TEXT PRIMARY KEY,
     run_id      TEXT NOT NULL,
     step_id     TEXT NOT NULL,
     status      TEXT NOT NULL,
     started_at  DATETIME NOT NULL,
     finished_at DATETIME,
     attempt     INTEGER NOT NULL,
     input       TEXT,
     output      TEXT,
     error_message TEXT,
     FOREIGN KEY(run_id) REFERENCES runs(id)
   );
   ```

2. **Query API.**  Provide functions in the engine to query runs by
   workflow name, status, or time range.  Expose an HTTP API (e.g.,
   `/api/runs`) that the UI can call to display run history.  Support
   pagination to avoid returning too many records at once.

3. **Cleanup tasks.**  Implement background tasks to purge old log records
   and run history based on retention policies.  Expose configuration
   options for users to control how long history should be kept.

## 4. UI Components for Observability

Integrate observability features into the UI built in Phase 6.

1. **Run list page.**  Display a table of recent runs with columns for run
   ID, workflow name, start time, status, and duration.  Provide filters and
   sorting.  Clicking on a run opens the run detail page.

2. **Run detail page.**  Show a timeline of step executions, including
   start/end times, status (success, failed, retried), and error messages.  Use
   icons and colors to indicate status.  Include collapsible sections to
   display input and output payloads (with sensitive fields masked).

3. **Log viewer.**  Provide a scrolling view of log entries associated with a
   run.  Allow searching and filtering by log level.  Use virtualization to
   handle large log streams efficiently.

4. **Metrics dashboard.**  Create a basic dashboard showing aggregate
   statistics (number of runs, success rate, average execution time).  Use
   charts (e.g., bar charts, histograms) via a library like `recharts`.
   Fetch metrics from the engine’s `/metrics` endpoint if enabled.

## 5. Guardrails and Best Practices

1. **Performance impact.**  Instrumentation should not significantly slow
   down workflow execution.  Use asynchronous logging and avoid blocking
   operations in hot paths.

2. **Privacy.**  Mask personally identifiable information (PII) and secrets
   in logs and metrics.  Provide a configuration option to disable logging
   input/output payloads entirely in sensitive environments.

3. **Data integrity.**  Wrap multiple inserts into transactions when writing
   run and step data.  On engine restart, mark incomplete runs as failed
   rather than leaving them in an indeterminate state.

4. **Time synchronization.**  Ensure that timestamps use a consistent time
   zone (e.g., UTC).  Avoid relying on local system clocks that may be
   misconfigured.

Implementing observability will make it much easier to debug workflows and
convince users that Acsa is ready for production workloads.
