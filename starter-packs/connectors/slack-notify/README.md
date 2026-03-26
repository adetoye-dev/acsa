# Slack Notify

Example starter pack for sending a Slack message from a workflow step.

This pack is installed into your local `connectors/` directory as a first-party
connector scaffold you can edit and commit.

## Prerequisites

- A Slack workspace where your app or webhook is allowed to post.
- One of:
  - Incoming webhook URL (`SLACK_WEBHOOK_URL`), or
  - Bot token (`SLACK_BOT_TOKEN`) with `chat:write` scope.
- Target channel name or channel ID (for token-based posting).
- Python 3.10+ runtime.

## Installation

1. Open Connectors in the ACSA UI.
2. Install the Slack Notify starter pack.
3. Confirm it appears in installed packs and connector inventory.
4. Add the required Slack secret(s) in `/credentials` or env vars.

## Configuration

Set secrets in credentials or environment variables:

- `SLACK_WEBHOOK_URL`: Incoming webhook endpoint.
- `SLACK_BOT_TOKEN`: Bot token used by Slack Web API.

Step fields:

- `inputs.message`: text to send.
- `params.channel`: channel name or ID (required for token mode; optional for webhook mode).

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
- `params.channel` (string): destination channel name or ID.
- Optional: expand this connector to support `params.blocks`, `params.thread_ts`, and `params.username`.

## Troubleshooting

- `missing Slack credentials`: set `SLACK_WEBHOOK_URL` or `SLACK_BOT_TOKEN`.
- `invalid_auth` or `not_in_channel`: verify bot scopes and channel membership.
- `channel_not_found`: use the correct channel ID/name.
- Network failures: verify proxy/firewall access to `slack.com`.
