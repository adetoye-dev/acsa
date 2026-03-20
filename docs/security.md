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

## Engine API exposure

- `acsa-core serve` binds to `127.0.0.1` by default.
- Binding the engine to a non-loopback address now requires `ACSA_ALLOW_REMOTE_ENGINE=1`.
- If `ACSA_ALLOW_REMOTE_ENGINE=1` is used with a non-loopback bind address, strongly prefer TLS/HTTPS for all client-to-engine traffic.
- Without TLS, any engine auth token is sent in plaintext on the network.
- When `ACSA_ENGINE_AUTH_TOKEN` is set, engine API routes require either:
  - `Authorization: Bearer <token>`
  - `x-acsa-engine-token: <token>`
- When `ACSA_ENGINE_AUTH_TOKEN` is not set, engine API routes are unauthenticated and do not require `Authorization: Bearer` or `x-acsa-engine-token`.
- Do not expose unauthenticated engine routes on non-loopback interfaces; either bind to loopback only or set `ACSA_ENGINE_AUTH_TOKEN` before enabling remote access.
- For remote engine access, enable native TLS for the engine where available, or terminate TLS at an HTTPS reverse proxy/load balancer with certificates managed by your platform (for example, ingress/LB-managed certs or standard CA-issued cert/key files).
- Recommended remote configuration example:

  ```bash
  ACSA_ALLOW_REMOTE_ENGINE=1 \
  ACSA_ENGINE_AUTH_TOKEN='<long-random-token>' \
  acsa-core serve --bind 0.0.0.0:3001
  ```

  Place this behind HTTPS/TLS before exposing it outside trusted local networks.
- Production risk note: running with `ACSA_ALLOW_REMOTE_ENGINE=1` and no TLS and/or no auth token can allow credential interception and unauthorized workflow administration.
- `/healthz` remains unauthenticated for local liveness checks.
- Webhook routes keep using per-workflow shared-secret and/or HMAC authentication instead of the engine admin token.

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

## UI browser hardening

- The Next.js UI now serves with a default Content Security Policy and baseline hardening headers.
- Acsa avoids `dangerouslySetInnerHTML`, `eval`, and dynamic function compilation in the browser code.

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
