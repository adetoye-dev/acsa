#!/usr/bin/env python3

import json
import os
import sys
from urllib import error as urllib_error
from urllib import request


def _post_json(url: str, body: dict, headers: dict | None = None) -> dict | str:
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
            return response_body


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
    except ValueError as error:
        print(f"invalid connector payload: {error}", file=sys.stderr)
        sys.exit(1)

    inputs = payload.get("inputs", {})
    params = payload.get("params", {})
    message = str(inputs.get("message", "")).strip()
    channel = params.get("channel", "#general")

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

    webhook_url = os.getenv("SLACK_WEBHOOK_URL")
    bot_token = os.getenv("SLACK_BOT_TOKEN")

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
            response = _post_json(webhook_url, {"text": message, "channel": channel})
            if not response.get("ok", True):
                raise RuntimeError(response.get("error", "webhook request failed"))
        else:
            response = _post_json(
                "https://slack.com/api/chat.postMessage",
                {"channel": channel, "text": message},
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
