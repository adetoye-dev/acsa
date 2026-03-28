#!/usr/bin/env python3

import json
import re
import sys
from urllib import error as urllib_error
from urllib import request as urllib_request


REPOSITORY_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
GITHUB_API_VERSION = "2026-03-10"
DEFAULT_USER_AGENT = "acsa-github-issue-create/0.1.0"


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

    if not isinstance(payload, dict):
        print("invalid connector payload: expected a top-level JSON object", file=sys.stderr)
        sys.exit(1)

    payload_inputs = payload.get("inputs")
    payload_params = payload.get("params")
    inputs = payload_inputs if isinstance(payload_inputs, dict) else {}
    params = payload_params if isinstance(payload_params, dict) else {}
    github_token = (
        inputs.get("github_token")
        or params.get("github_token")
        or params.get("token")
    )

    title = inputs.get("title")
    repository = inputs.get("repository") or params.get("repository")

    if not title or not str(title).strip():
        print(
            json.dumps(
                {
                    "issue_created": False,
                    "error": "missing required input: title",
                    "repository": repository or "",
                    "title": title or "",
                    "labels": inputs.get("labels", []),
                    "issue_number": None,
                    "issue_url": None,
                    "issue_id": None,
                }
            )
        )
        return

    if not repository or not REPOSITORY_PATTERN.match(str(repository).strip()):
        print(
            json.dumps(
                {
                    "issue_created": False,
                    "error": "repository must match owner/repo",
                    "repository": repository or "",
                    "title": str(title).strip(),
                    "labels": inputs.get("labels", []),
                    "issue_number": None,
                    "issue_url": None,
                    "issue_id": None,
                }
            )
        )
        return

    if not github_token or not str(github_token).strip():
        print(
            json.dumps(
                {
                    "issue_created": False,
                    "error": "missing required credential: github_token",
                    "repository": str(repository).strip(),
                    "title": str(title).strip(),
                    "labels": inputs.get("labels", []),
                    "issue_number": None,
                    "issue_url": None,
                    "issue_id": None,
                }
            )
        )
        return

    owner, repo = str(repository).strip().split("/", 1)
    endpoint = f"https://api.github.com/repos/{owner}/{repo}/issues"
    user_agent = (
        inputs.get("user_agent")
        or params.get("user_agent")
        or DEFAULT_USER_AGENT
    )

    body = {
        "title": str(title).strip(),
        "body": "" if inputs.get("body") is None else str(inputs.get("body")),
    }
    if isinstance(inputs.get("labels"), list):
        body["labels"] = [str(item) for item in inputs.get("labels", [])]
    if isinstance(inputs.get("assignees"), list):
        body["assignees"] = [str(item) for item in inputs.get("assignees", [])]
    if "milestone" in inputs and inputs.get("milestone") is not None:
        body["milestone"] = inputs.get("milestone")

    payload = json.dumps(body).encode("utf-8")
    req = urllib_request.Request(
        endpoint,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {str(github_token).strip()}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": GITHUB_API_VERSION,
            "Content-Type": "application/json",
            "User-Agent": str(user_agent).strip(),
        },
    )

    try:
        with urllib_request.urlopen(req, timeout=30) as response:
            response_body = response.read().decode("utf-8")
            if response.status != 201:
                raise RuntimeError(f"unexpected GitHub status: {response.status}")
            provider = json.loads(response_body)
    except urllib_error.HTTPError as error:
        details = error.read().decode("utf-8") if error.fp else ""
        message = f"github api request failed with status {error.code}"
        if details:
            try:
                parsed = json.loads(details)
                api_message = parsed.get("message") if isinstance(parsed, dict) else None
                if api_message:
                    message = f"{message}: {api_message}"
            except json.JSONDecodeError:
                pass
        print(
            json.dumps(
                {
                    "issue_created": False,
                    "error": message,
                    "repository": str(repository).strip(),
                    "title": str(title).strip(),
                    "labels": inputs.get("labels", []),
                    "issue_number": None,
                    "issue_url": None,
                    "issue_id": None,
                }
            )
        )
        return
    except (urllib_error.URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as error:
        print(
            json.dumps(
                {
                    "issue_created": False,
                    "error": f"github api request failed: {error}",
                    "repository": str(repository).strip(),
                    "title": str(title).strip(),
                    "labels": inputs.get("labels", []),
                    "issue_number": None,
                    "issue_url": None,
                    "issue_id": None,
                }
            )
        )
        return

    print(
        json.dumps(
            {
                "issue_created": True,
                "repository": str(repository).strip(),
                "title": str(title).strip(),
                "labels": inputs.get("labels", []),
                "issue_number": provider.get("number"),
                "issue_url": provider.get("html_url"),
                "issue_id": str(provider.get("id")) if provider.get("id") is not None else None,
            }
        )
    )


if __name__ == "__main__":
    main()
