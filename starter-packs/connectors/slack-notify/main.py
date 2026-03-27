#!/usr/bin/env python3

import json
import os
import sys
from urllib import error as urllib_error
from urllib import request


def _post_json(url: str, body: dict, headers: dict | None = None) -> dict:
    payload = json.dumps(body).encode("utf-8")
    merged_headers = {"content-type": "application/json"}
    if headers:
        merged_headers.update(headers)

    req = request.Request(url=url, data=payload, headers=merged_headers, method="POST")
    with request.urlopen(req, timeout=15) as response:
        response_body = response.read().decode("utf-8").strip()
        if not response_body:
            return {}
        try:
            return json.loads(response_body)
        except json.JSONDecodeError:
            if response_body.lower() == "ok":
                return {"ok": True}
            return {"ok": False, "error": "non_json_response", "text": response_body}


def main() -> None:
    raw_payload = sys.stdin.read()
    try:
        payload = json.loads(raw_payload)
    except json.JSONDecodeError as error:
        print(
            f"invalid JSON input: {error.msg} at line {error.lineno} column {error.colno}",
            file=sys.stderr,
        )
        sys.exit(1)

    inputs = payload.get("inputs", {})
    params = payload.get("params", {})

    raw_message = inputs.get("message", "")
    message = "" if raw_message is None else str(raw_message).strip()

    raw_channel = inputs.get("channel", params.get("channel", "#general"))
    channel = "#general" if raw_channel is None else str(raw_channel).strip() or "#general"

    username = inputs.get("username")
    icon_emoji = inputs.get("icon_emoji")
    attachments = inputs.get("attachments")

    if not message:
        print(
            json.dumps(
                {
                    "sent": False,
                    "channel": channel,
                    "message": message,
                    "error": "missing required input: message",
                }
            )
        )
        sys.exit(1)

    webhook_url = (os.getenv("SLACK_WEBHOOK_URL") or "").strip()
    bot_token = (os.getenv("SLACK_BOT_TOKEN") or "").strip()

    if not webhook_url and not bot_token:
        print(
            json.dumps(
                {
                    "sent": False,
                    "channel": channel,
                    "message": message,
                    "error": "missing Slack credentials: set SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN",
                }
            )
        )
        sys.exit(1)

    try:
        if webhook_url:
            webhook_payload = {"text": message}
            if isinstance(username, str) and username.strip():
                webhook_payload["username"] = username.strip()
            if isinstance(icon_emoji, str) and icon_emoji.strip():
                webhook_payload["icon_emoji"] = icon_emoji.strip()
            if isinstance(attachments, list):
                webhook_payload["attachments"] = attachments

            # Incoming webhooks can ignore channel overrides depending on workspace policy.
            response = _post_json(webhook_url, webhook_payload)
            if not response.get("ok", True):
                raise RuntimeError(response.get("error", "webhook request failed"))
        else:
            bot_payload = {"channel": channel, "text": message}
            if isinstance(username, str) and username.strip():
                bot_payload["username"] = username.strip()
            if isinstance(icon_emoji, str) and icon_emoji.strip():
                bot_payload["icon_emoji"] = icon_emoji.strip()
            if isinstance(attachments, list):
                bot_payload["attachments"] = attachments

            response = _post_json(
                "https://slack.com/api/chat.postMessage",
                bot_payload,
                headers={"Authorization": f"Bearer {bot_token}"},
            )
            if not response.get("ok", False):
                raise RuntimeError(response.get("error", "unknown Slack API error"))

        print(
            json.dumps(
                {
                    "sent": True,
                    "channel": channel,
                    "message": message,
                }
            )
        )
    except (urllib_error.URLError, TimeoutError, RuntimeError, ValueError) as error:
        print(f"slack notify failed: {error}", file=sys.stderr)
        print(
            json.dumps(
                {
                    "sent": False,
                    "channel": channel,
                    "message": message,
                    "error": str(error),
                }
            )
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
