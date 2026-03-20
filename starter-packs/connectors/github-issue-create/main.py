#!/usr/bin/env python3

import json
import sys


def main() -> None:
    payload = json.load(sys.stdin)
    inputs = payload.get("inputs", {})
    params = payload.get("params", {})
    print(json.dumps({
        "issue_created": True,
        "repository": params.get("repository", "owner/repo"),
        "title": inputs.get("title", ""),
        "labels": inputs.get("labels", []),
    }))


if __name__ == "__main__":
    main()
