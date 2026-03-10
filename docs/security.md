# Security Guide

Acsa is designed to be local-first and security-biased by default. This document records the current hardening posture, operational controls, and accepted residual risk.

## Secret handling

- Keep secrets out of workflow YAML.
- Use `*_env` references such as `secret_env`, `token_env`, `signature_env`, `headers_env`, `connection_env`, and `secrets_env`.
- Workflow save APIs reject inline secret-like values for trigger and step fields.
- Run logs and run-detail payloads redact secret-like JSON keys before persistence.

## Trigger security

Webhook triggers support either or both of these controls:

- Shared-secret header validation with `secret_env` or `token_env`
- HMAC SHA-256 request signing with `signature_env`

Optional webhook fields:

- `header`: shared-secret header name, default `x-acsa-webhook-token`
- `signature_header`: signature header name, default `x-acsa-signature`
- `signature_prefix`: signature prefix, default `sha256=`

If both token and signature validation are configured, both checks must pass.

## Built-in node controls

- `http_request`
  - HTTPS-only by default
  - `allow_insecure: true` is limited to loopback and private hosts
  - URL-embedded credentials are rejected
  - sensitive request headers must come from `headers_env`
  - response bodies are size-limited
- `database_query`
  - SQLite paths stay inside the Acsa data directory
  - PostgreSQL connections must come from `connection_env`
- `file_read` and `file_write`
  - paths stay inside the Acsa data directory
  - file sizes are bounded

## Connector runtime controls

- Process connectors
  - run with a cleared environment except for `PATH` and explicitly allowed variables from `allowed_env`
  - require explicit timeouts
  - reject manifest-declared memory limits because the current runtime does not enforce them safely across platforms
  - return JSON through bounded stdout
- WASM connectors
  - are disabled by default
  - require `ACSA_ENABLE_WASM_CONNECTORS=1` to opt in
  - require explicit timeout and memory limits
  - support host allowlists through `allowed_hosts`
  - support filesystem mapping through `allowed_paths` only when `enable_wasi=true`

## Logging and observability

- `ACSA_LOG_PAYLOADS=0` hides step payloads from run-detail responses.
- `ACSA_LOG_FILE_PATH` mirrors redacted structured logs to disk.
- `ACSA_LOG_RETENTION_DAYS` and `ACSA_RUN_RETENTION_DAYS` control retention cleanup.
- Plain-text log messages redact bearer tokens, common key/value credential patterns, and PostgreSQL DSN passwords before persistence.

## Dependency audit posture

The remaining RustSec findings are upstream Wasmtime issues pulled in through `extism 1.13.0`.

Current accepted residual risk:

- WASM connectors are opt-in rather than enabled by default.
- Connector manifests enforce timeout and memory ceilings before the runtime is entered.
- Process connectors remain available for trusted local integrations.

Planned follow-up:

1. Upgrade `extism` as soon as it ships a patched Wasmtime dependency chain.
2. Remove the temporary audit exceptions once upstream fixes land.
3. Re-run release verification with the patched dependency set before the next tagged release.

The checked-in audit command is `./scripts/security-audit.sh`, which keeps the current accepted exception list explicit in version control and CI.
