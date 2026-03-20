#!/usr/bin/env python3

import json
import sys


def main() -> None:
    payload = json.load(sys.stdin)
    inputs = payload.get("inputs", {})
    print(json.dumps({
        "appended": True,
        "sheet_id": inputs.get("sheet_id", ""),
        "row": inputs.get("row", {}),
    }))


if __name__ == "__main__":
    main()
