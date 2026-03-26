#!/usr/bin/env python3

import json
import sys


def main() -> None:
    raw_payload = ""
    try:
        raw_payload = sys.stdin.read()
        payload = json.loads(raw_payload)
    except json.JSONDecodeError as error:
        snippet = raw_payload[:160].replace("\n", "\\n")
        print(
            f"invalid JSON input: {error.msg} at line {error.lineno} column {error.colno}; input prefix={snippet}",
            file=sys.stderr,
        )
        sys.exit(1)
    except Exception as error:
        print(f"unexpected error while reading connector payload: {error}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(payload, dict):
        print("invalid connector payload: expected a top-level JSON object", file=sys.stderr)
        sys.exit(1)

    inputs = payload.get("inputs", {})
    params = payload.get("params", {})
    
    if not isinstance(inputs, dict):
        print("invalid connector payload: inputs must be a JSON object", file=sys.stderr)
        sys.exit(1)
    if not isinstance(params, dict):
        print("invalid connector payload: params must be a JSON object", file=sys.stderr)
        sys.exit(1)

    # MOCK IMPLEMENTATION: this starter pack does not send real email yet.
    print(
        json.dumps(
            {
                "mock": True,
                "would_send": True,
                "sent": False,
                "recipient": params.get("recipient", "user@example.com"),
                "subject": inputs.get("subject", ""),
            }
        )
    )


if __name__ == "__main__":
    main()
