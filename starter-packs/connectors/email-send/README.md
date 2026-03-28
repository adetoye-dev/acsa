# Email Send

Example starter pack for sending an email from a workflow step.

Use it as an app-installed baseline for a real delivery connector.

## Installation / Setup

1. Install this starter pack from the Connectors page in the UI.
2. Verify the connector appears as `email_send` in the Connectors page.
3. Configure credentials in the Credentials screen or provide environment variables.
4. Run a connector test or workflow run with a sample payload.

## Prerequisites

- Access to an SMTP server or provider email API.
- Credentials for that provider (username/password or API key).
- Encrypted SMTP transport is strongly recommended in production: use STARTTLS (`smtp_tls: true`) or implicit SSL/TLS (`smtp_secure: true`).
- For local testing only, unencrypted SMTP may be used if both `smtp_tls` and `smtp_secure` are unset/false.
- Prefer TLS 1.2+ with certificate verification enabled.
- Common secure SMTP ports: `587` for STARTTLS, `465` for implicit SSL/TLS.
- Python 3.10+ available in the runtime where connector processes execute.
- Network access from runtime to your mail provider endpoint.

## Configuration

Connection and authentication settings belong in step `params`. For secrets, `params` should carry secret references (for example `${SMTP_PASSWORD}`), while the actual secret values are stored in `secure secrets`:

Do not hardcode real secret values in `params` or commit them to version control. Use placeholder secret references in `params` only, and keep real values in `secure secrets`.

One-line pattern: `params.password: "${SMTP_PASSWORD}"` with `secure secrets` containing `SMTP_PASSWORD=<real-value>`.

- `smtp_host`: SMTP host name, for example `smtp.example.com`.
- `smtp_port`: SMTP port as number, for example `587`.
- `smtp_tls`: enables STARTTLS (explicit TLS upgrade), commonly used with port `587`.
- `smtp_secure`: enables implicit SSL/TLS, commonly used with port `465`.
- `smtp_tls` and `smtp_secure` are mutually exclusive.
- For encrypted mode, set exactly one to `true` and set the other to `false` or omit it.
- For local testing only, both may be omitted/false to run plain SMTP.
- `username`: SMTP username.
- `password`: use for SMTP username/password authentication (common with SMTP transport).
- `api_key`: use for provider HTTP API credential style flows (for example API-based providers).
- If both are provided, connector validation fails with `ambiguous_auth_config`; provide exactly one.
- `from_address`: sender email, for example `alerts@example.com`.

SMTP password auth example:

```yaml
params:
  smtp_host: "smtp.example.com"
  smtp_port: 587
  smtp_tls: true
  smtp_secure: false
  username: "smtp-user"
  password: "${SMTP_PASSWORD}"
```

API-key-style auth example:

```yaml
params:
  smtp_host: "api.mail-provider.example"
  smtp_port: 465
  smtp_tls: false
  smtp_secure: true
  username: "apikey"
  api_key: "${MAIL_PROVIDER_API_KEY}"
```

Message-specific fields like `subject` and `body` are typically provided in the step `inputs` (per-message content), but may also be passed via `params` if desired:

- `recipient`: destination email address (main field name; `to_address` is an accepted alias for backward compatibility). Prefer `inputs.recipient` for per-message values. Optionally set `params.recipient` as a default static destination, which can be overridden by `inputs.recipient`.
- `subject`: message subject line.
- `body`: message body text.

Example: `params` contains connection/config values and secret references, `secure secrets` contains the real credential values, and `inputs` contains per-message content like subject and body.

Expected formats:

- Email addresses should follow RFC 5322 ASCII mailbox syntax (`local@domain`).
- Internationalized (UTF-8 local-part) addresses per RFC 6531 are not currently supported by this starter pack validation.
- `smtp_port` should be an integer.
- `subject` and `body` should be non-empty strings.

## Basic Usage Example

Preferred per-message recipient in `inputs`:

```yaml
steps:
  - id: send_email
    type: email_send
    params:
      from_address: "alerts@example.com"
      smtp_host: "smtp.example.com"
      smtp_port: 587
      smtp_tls: true
      smtp_secure: false
      username: "smtp-user"
      password: "${SMTP_PASSWORD}"
    inputs:
      recipient: "ops@example.com"
      subject: "Run completed"
      body: "Workflow finished successfully"
```

Optional static default recipient in `params` (overridable by `inputs.recipient`):

```yaml
steps:
  - id: send_email
    type: email_send
    params:
      recipient: "ops@example.com"
      from_address: "alerts@example.com"
      smtp_host: "smtp.example.com"
      smtp_port: 465
      smtp_tls: false
      smtp_secure: true
      username: "smtp-user"
      password: "${SMTP_PASSWORD}"
    inputs:
      recipient: "oncall@example.com"
      subject: "Run completed"
      body: "Workflow finished successfully"
```

For the example above, keep the real secret value in secure secrets (for example `SMTP_PASSWORD=<real-password>`) and only keep `password: "${SMTP_PASSWORD}"` in `params`.

TLS mode note: use `smtp_tls: true` with port `587` for STARTTLS, and `smtp_secure: true` with port `465` for implicit TLS. Exact behavior depends on connector implementation details.

Use secure secret handling for sensitive values:

- Prefer the in-app Credentials screen at `/credentials`.
- Or inject secrets through environment variables and map them through connector params.

## Troubleshooting

- `Authentication failed`: verify username/password or API key and provider policy.
- `Connection timeout`: verify host, port, firewall, and TLS requirements.
- `Invalid recipient`: validate `to_address` or `recipient` format.
- `Connector reports mock output` status:
  - Implemented now:
    - input payload parsing and validation
    - SMTP host safety validation
    - TLS mode flag validation (`smtp_tls`/`smtp_secure`)
    - credential key names and ambiguity checks (`password` vs `api_key`)
    - structured output and structured error payloads
  - Mocked now:
    - mock send/response only (`mock: true`, `would_send: true`)
    - no real SMTP/API network send and no email delivery performed
  - TODO before real sending:
    - actual SMTP and/or provider API delivery implementation
    - delivery retries and provider-specific error mapping
    - production-grade transport/auth hardening and observability
  - Not production ready:
    - do not rely on this starter pack for real notification delivery until real send logic is implemented and explicitly enabled.

See also:

- [docs/connector-development.md](../../../docs/dev/connector-development.md)
- [docs/security.md](../../../docs/dev/security.md)
