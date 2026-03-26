#!/usr/bin/env python3

import json
import re
import sys


REPOSITORY_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


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
        print(f"invalid input payload: {error}", file=sys.stderr)
        sys.exit(1)

    inputs = payload.get("inputs", {})
    params = payload.get("params", {})

    title = inputs.get("title")
    repository = inputs.get("repository") or params.get("repository")

    if not title or not str(title).strip():
        print(
            json.dumps(
                {
                    "issue_created": False,
                    "mock": True,
                    "error": "missing required input: title",
                    "repository": repository or "",
                    "title": title or "",
                    "labels": inputs.get("labels", []),
                    "issue_number": None,
                    "issue_url": None,
                }
            )
        )
        return

    if not repository or not REPOSITORY_PATTERN.match(str(repository).strip()):
        print(
            json.dumps(
                {
                    "issue_created": False,
                    "mock": True,
                    "error": "repository must match owner/repo",
                    "repository": repository or "",
                    "title": str(title).strip(),
                    "labels": inputs.get("labels", []),
                    "issue_number": None,
                    "issue_url": None,
                }
            )
        )
        return

    # MOCK IMPLEMENTATION: no GitHub API call performed.
    # TODO: Implement real issue creation using requests or PyGithub.
    # Use repository/title/labels from this payload to call GitHub Issues API,
    # then populate issue_number and issue_url from provider response.
    print(
        json.dumps(
            {
                "issue_created": False,
                "mock": True,
                "repository": str(repository).strip(),
                "title": str(title).strip(),
                "labels": inputs.get("labels", []),
                "issue_number": None,
                "issue_url": None,
            }
        )
    )


if __name__ == "__main__":
    main()
