#!/usr/bin/env python3

import json
import sys


def main() -> None:
    payload = json.load(sys.stdin)
    inputs = payload.get("inputs", {})
    params = payload.get("params", {})
    print(json.dumps({
        "sent": True,
        "recipient": params.get("recipient", "user@example.com"),
        "subject": inputs.get("subject", ""),
    }))


if __name__ == "__main__":
    main()
