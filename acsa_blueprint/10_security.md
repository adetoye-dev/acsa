# Phase 10: Security Guardrails and Best Practices

Security must be embedded throughout Acsa’s architecture and development
process.  This document summarises the guardrails that the AI agent and
future contributors should follow at every phase of the project.

## 1. Licensing and Compliance

1. **Respect the license.**  Acsa is Apache 2.0.  Do not integrate code or
   dependencies with incompatible licenses (e.g., GPLv3) without legal
   review.  Include license headers in source files and maintain a
   `NOTICE` file if required.

2. **Third‑party licenses.**  Review the licenses of all Rust crates and
   JavaScript packages.  Use tools like `cargo-license` and `license-checker`
   to audit dependencies.  Document them in the release notes.

## 2. Secure Coding Practices

1. **Input validation.**  Validate all user input, including YAML files,
   connector manifests, HTTP requests, and form fields.  Reject invalid or
   malformed input with clear error messages.  Use strict types and avoid
   dynamic code execution.

2. **Error handling.**  Propagate errors with context using the `anyhow` or
   `thiserror` crates.  Never panic in production; instead, return a
   recoverable error and mark the workflow run as failed.

3. **Secrets management.**  Store secrets (API keys, database passwords)
   outside of workflow YAML files.  Accept them via environment variables or
   secret managers (e.g., HashiCorp Vault, AWS Secrets Manager).  In the UI,
   reference secrets by name rather than storing raw values.

4. **Logging hygiene.**  Redact sensitive data in logs.  Do not log full
   request/response bodies or headers that contain secrets.  Provide
   configuration to disable payload logging entirely.

5. **Memory safety.**  Rust’s ownership model prevents many classes of
   security bugs, but unsafe code should be avoided.  Audit any `unsafe`
   blocks carefully.  Favour crates with strong safety guarantees.

6. **Concurrency safety.**  Avoid deadlocks by using non‑blocking
   synchronization primitives.  Limit the number of concurrent tasks to
   prevent denial‑of‑service through resource exhaustion.

7. **No dynamic code injection.**  When evaluating expressions or running
   user scripts, use vetted libraries (e.g., `rhai`) that sandbox evaluation.
   Do not use `eval` or dynamically compile code at runtime.

## 3. Plugin Isolation

1. **Sandboxing.**  Run WebAssembly connectors in the extism sandbox with
   restricted WASI permissions.  Disallow file and network access unless
   explicitly granted.  Set memory and timeouts via the manifest.

2. **Subprocess restrictions.**  Launch subprocess connectors under a
   restricted user.  Use OS features (e.g., cgroups, `setrlimit`) to limit
   CPU and memory.  Do not inherit the parent process’s environment except
   for explicitly passed variables (e.g., secrets).

3. **Path validation.**  For file‑related nodes and connectors, validate
   paths against a whitelist to prevent directory traversal.  Never allow
   absolute paths outside the configured data directory.

## 4. Network and API Security

1. **HTTPS only.**  When calling external APIs from nodes, enforce HTTPS and
   verify TLS certificates.  Do not allow insecure protocols unless the
   user explicitly opts in.

2. **Rate limiting.**  Implement client‑side throttling to respect API rate
   limits.  Provide configuration options per node.  If a provider returns
   `429 Too Many Requests`, retry after the recommended delay.

3. **Authentication.**  For webhook triggers, require a secret token or
   HMAC signature.  Validate the signature before starting a workflow run.
   Never expose internal endpoints publicly without authentication.

## 5. CI/CD and Build Security

1. **Automated tests.**  Include unit tests and integration tests for all
   nodes and engine components.  Run them in continuous integration (CI)
   pipelines.

2. **Static analysis.**  Integrate tools like `cargo-audit`, `cargo-deny`,
   and `clippy` to detect security vulnerabilities, outdated dependencies,
   and code quality issues.  Fail the build on critical findings.

3. **Supply chain security.**  Pin dependency versions and verify checksums.
   Use `cargo vet` (if available) or similar to audit dependencies.
   Sign release artifacts with a trusted GPG key and publish checksums.

4. **Least privilege in CI.**  CI jobs should run with minimal permissions.
   Do not store secrets in the repository or expose them to untrusted pull
   requests.  Use per‑job tokens with restricted scopes.

## 6. Runtime Security

1. **Resource limits.**  Expose configuration parameters for maximum
   concurrency, memory usage, and step timeouts.  Provide sensible defaults
   and enforce limits at runtime.

2. **Isolation by default.**  Run the engine in its own process with a
   dedicated user account.  Consider containerization or microVMs for
   additional isolation.

3. **Monitoring and alerting.**  Integrate with monitoring systems to send
   alerts on high error rates, slow executions, or unusual resource usage.
   Document how to configure alerts.

4. **Upgrades and patches.**  Stay current with security patches for Rust,
   NPM, and third‑party dependencies.  Schedule regular dependency updates
   and security reviews.

By following these guardrails, Acsa will remain secure, reliable, and
maintainable as it evolves and the community grows.
