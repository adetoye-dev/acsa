#!/usr/bin/env python3

import json
import sys


def choose_lane(primary, fallback):
    if isinstance(primary, dict):
        return primary
    if isinstance(fallback, dict):
        return fallback
    return {}


def main() -> None:
    payload = json.load(sys.stdin)
    inputs = payload.get("inputs", {})
    params = payload.get("params", {})

    repo_context = inputs.get("repo_context", {}) or {}
    worktree_lane = choose_lane(
        inputs.get("review_before_release"),
        inputs.get("clean_candidate"),
    )
    risk_lane = choose_lane(
        inputs.get("high_risk_lane"),
        inputs.get("standard_risk_lane"),
    )

    product_name = params.get("product_name", repo_context.get("repo_name", "Acsa"))
    output_file = params.get("output_file", "data/demo/output/release-brief.md")

    changed_files = repo_context.get("changed_files", []) or []
    recent_commits = repo_context.get("recent_commits", []) or []
    recommended_checks = repo_context.get("recommended_checks", []) or []
    risk_reasons = repo_context.get("risk_reasons", []) or []
    diff_stats = repo_context.get("diff_stats", {}) or {}
    top_areas = repo_context.get("top_areas", []) or []

    changed_lines = [
        f"- `{entry.get('status', '?')}` {entry.get('path', '')}"
        for entry in changed_files[:10]
    ] or ["- Working tree is clean."]
    commit_lines = [
        f"- `{commit.get('sha', '')}` {commit.get('subject', '')} — {commit.get('author', '')}"
        for commit in recent_commits[:5]
    ] or ["- No recent commits found."]
    risk_lines = [f"- {reason}" for reason in risk_reasons] or ["- No specific risk reason."]
    check_lines = [f"- `{command}`" for command in recommended_checks] or ["- No checks suggested."]

    markdown = f"""# {product_name} release brief

Generated locally by Acsa from the live Git checkout.

## Snapshot
- Repository: `{repo_context.get('repo_name', 'unknown')}`
- Branch: `{repo_context.get('branch', 'unknown')}`
- Head: `{repo_context.get('head_sha', 'unknown')}`
- Working tree lane: `{worktree_lane.get('lane', 'unknown')}`
- Risk badge: `{risk_lane.get('risk_badge', repo_context.get('risk_level', 'unknown'))}`
- Changed files: `{repo_context.get('dirty_file_count', 0)}`
- Diff stats: `+{diff_stats.get('insertions', 0)} / -{diff_stats.get('deletions', 0)}`
- Dominant areas: {", ".join(top_areas) or "none"}

## Release risk
{chr(10).join(risk_lines)}

## Recommended checks
{chr(10).join(check_lines)}

## Recent commits
{chr(10).join(commit_lines)}

## Current worktree
{chr(10).join(changed_lines)}

## Suggested handoff
- Reviewer lane: `{risk_lane.get('reviewer', 'unknown')}`
- Release guidance: {risk_lane.get('release_guidance', 'No guidance available.')}
- Next action: {worktree_lane.get('next_action', 'No next action available.')}

## Why this demo matters
- It runs on actual local Git data, not a mocked payload.
- Workflow orchestration stays in YAML under version control.
- Connectors stay lightweight and local.
- The result is a real artifact at `{output_file}` that another engineer can use immediately.
"""

    summary_line = (
        f"{repo_context.get('repo_name', 'repo')}:{repo_context.get('branch', 'unknown')} "
        f"risk={repo_context.get('risk_level', 'unknown')} dirty={repo_context.get('dirty_file_count', 0)}"
    )
    json.dump({"markdown": markdown, "summary_line": summary_line}, sys.stdout)


if __name__ == "__main__":
    main()
