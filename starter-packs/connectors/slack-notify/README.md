# Slack Notify

Example starter pack for sending a Slack message from a workflow step.

This pack installs into Acsa's app-managed connector runtime as a first-party
connector you can use immediately and customize later.

## Prerequisites

- A Slack workspace where your app or webhook is allowed to post.
- One of:
  - Incoming webhook URL (`SLACK_WEBHOOK_URL`), or
  - Bot token (`SLACK_BOT_TOKEN`) with `chat:write` scope.
- Target channel name or channel ID (for token-based posting).
- Python 3.10+ runtime.

## Installation

1. Open Connectors in the Autonomous Cloud Service Assistant (ACSA) UI.
2. Install the Slack Notify starter pack.
3. Confirm it appears in installed packs and connector inventory.
4. Add the required Slack secret(s) in Credentials or via environment variables (`SLACK_WEBHOOK_URL`, `SLACK_BOT_TOKEN`).

## Configuration

Set secrets in credentials or environment variables:

- `SLACK_WEBHOOK_URL`: Incoming webhook endpoint.
- `SLACK_BOT_TOKEN`: Bot token used by Slack Web API.
- In `credentials/.env` (plaintext), use exact key names:

```env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T000/B000/XXXX
SLACK_BOT_TOKEN=xoxb-1234567890-abcdefghijklmnop
```

Security Note: plaintext `.env` secrets are not recommended for production. Prefer managed secret stores (for example AWS Secrets Manager, HashiCorp Vault, or Kubernetes Secrets), and never commit `.env` files to version control.

- Or in `credentials/slack.json` (JSON), use the same exact key names:

```json
{
  "SLACK_WEBHOOK_URL": "https://hooks.slack.com/services/T000/B000/XXXX",
  "SLACK_BOT_TOKEN": "xoxb-1234567890-abcdefghijklmnop"
}
```

Security Note: never commit credential files (`.env` or `.json`) to version control. Add the `credentials/` directory to `.gitignore`, and prefer managed secret stores (for example AWS Secrets Manager, HashiCorp Vault, or Kubernetes Secrets).

- As an alternative to credentials files, environment variables `SLACK_WEBHOOK_URL` and `SLACK_BOT_TOKEN` are supported directly.

Credential precedence: if both are configured, `SLACK_WEBHOOK_URL` takes precedence and the connector sends through the incoming webhook path; `SLACK_BOT_TOKEN` is used only when `SLACK_WEBHOOK_URL` is not set. Example: with both values present, the connector posts via webhook and does not call `chat.postMessage`.

Step fields:

- `inputs.message`: text to send.
- `params.channel`: channel name or ID (required for token mode).
- In webhook mode, `inputs.message` is always the message body.
- In webhook mode, `params.channel` is honored only if the incoming webhook itself allows channel overrides.
- If webhook overrides are not supported (or `params.channel` is omitted), delivery goes to the webhook's configured default channel and the connector cannot change it.

## Usage

```yaml
steps:
  - id: notify_slack
    type: slack_notify
    params:
      channel: "#alerts"
    inputs:
      message: "Deployment finished successfully"
```

## Parameters

- `inputs.message` (string): message body sent to Slack.
- `params.channel` (string): destination channel name or ID (required for token mode; optional for webhook mode).
- Optional: expand this connector to support `params.blocks`, `params.thread_ts`, and `params.username`.

## Troubleshooting

- `missing Slack credentials`: set `SLACK_WEBHOOK_URL` or `SLACK_BOT_TOKEN`.
- `invalid_auth` or `not_in_channel`: verify bot scopes and channel membership.
- `channel_not_found`: use the correct channel ID/name.
- Network failures: verify proxy/firewall access to `slack.com`.
