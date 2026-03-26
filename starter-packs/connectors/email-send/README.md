# Email Send

Example starter pack for sending an email from a workflow step.

Use it as the installed, Git-visible baseline for a real delivery connector.

## Installation / Setup

1. Install this starter pack from the Connectors page in the UI.
2. Verify the connector appears as `email_send` in your local connector inventory.
3. Configure credentials in the Credentials screen or provide environment variables.
4. Run a connector test or workflow run with a sample payload.

## Prerequisites

- Access to an SMTP server or provider email API.
- Credentials for that provider (username/password or API key).
- Python 3.10+ available in the runtime where connector processes execute.
- Network access from runtime to your mail provider endpoint.

## Configuration

Connection and authentication settings belong in step `params`, with sensitive values stored in `secure secrets`:

- `smtp_host`: SMTP host name, for example `smtp.example.com`.
- `smtp_port`: SMTP port as number, for example `587`.
- `username`: SMTP username.
- `password` or `api_key`: provider credential.
- `from_address`: sender email, for example `alerts@example.com`.

Message-specific fields like `subject` and `body` are typically provided in the step `input` (per-message content), but may also be passed via `params` if desired:

- `to_address` (or `recipient`): destination email.
- `subject`: message subject line.
- `body`: message body text.

Example: `params` contains connection/config values, `secure secrets` contains credentials (like `${SMTP_PASSWORD}`), and `input` contains per-message content like subject and body.

Expected formats:

- Email addresses should be RFC-compatible mailbox strings.
- `smtp_port` should be an integer.
- `subject` and `body` should be non-empty strings.

## Basic Usage Example

```yaml
steps:
  - id: send_email
    type: email_send
    params:
      recipient: "ops@example.com"
      from_address: "alerts@example.com"
      smtp_host: "smtp.example.com"
      smtp_port: 587
      username: "smtp-user"
      password: "${SMTP_PASSWORD}"
    input:
      subject: "Run completed"
      body: "Workflow finished successfully"
```

Use secure secret handling for sensitive values:

- Prefer the in-app Credentials screen at `/credentials`.
- Or inject secrets through environment variables and map them through connector params.

## Troubleshooting

- `Authentication failed`: verify username/password or API key and provider policy.
- `Connection timeout`: verify host, port, firewall, and TLS requirements.
- `Invalid recipient`: validate `to_address` or `recipient` format.
- `Connector reports mock output`: this starter pack may be a scaffold until full sending logic is implemented.

See also:

- [docs/connector-development.md](../../../docs/connector-development.md)
- [docs/security.md](../../../docs/security.md)
