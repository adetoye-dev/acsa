#!/usr/bin/env python3

import json
import sys


def main() -> None:
    payload = json.load(sys.stdin)
    inputs = payload.get("inputs", {})
    params = payload.get("params", {})
    message = inputs.get("message", "")
    channel = params.get("channel", "#general")
    print(json.dumps({
        "sent": True,
        "channel": channel,
        "message": message,
    }))


if __name__ == "__main__":
    main()
