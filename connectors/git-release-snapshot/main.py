#!/usr/bin/env python3

import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

HIGH_RISK_AREAS = {"core", "connectors", "deploy", "packaging", "scripts", "workflows"}
UI_AREAS = {"ui"}
DOC_AREAS = {"docs", "examples"}


def run_git(repo_root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo_root), *args],
        capture_output=True,
        check=True,
        text=True,
    )
    return result.stdout.rstrip("\n")


def has_head_commit(repo_root: Path) -> bool:
    try:
        run_git(repo_root, "rev-parse", "--verify", "HEAD")
    except subprocess.CalledProcessError:
        return False
    return True


def current_branch(repo_root: Path) -> str:
    try:
        return run_git(repo_root, "symbolic-ref", "--short", "HEAD")
    except subprocess.CalledProcessError:
        return ""


def parse_status_line(line: str) -> dict:
    status = line[:2].strip() or "?"
    path = line[3:].strip()
    if " -> " in path:
        path = path.split(" -> ", 1)[1]
    area = path.split("/", 1)[0] if "/" in path else "root"
    return {"area": area, "path": path, "status": status}


def parse_numstat(output: str) -> dict:
    insertions = 0
    deletions = 0
    touched = 0
    for line in output.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        added_raw, deleted_raw, _path = parts[:3]
        try:
            added = 0 if added_raw == "-" else int(added_raw)
            deleted = 0 if deleted_raw == "-" else int(deleted_raw)
        except ValueError:
            added = 0
            deleted = 0
        insertions += added
        deletions += deleted
        touched += 1
    return {
        "files": touched,
        "insertions": insertions,
        "deletions": deletions,
    }


def compute_risk(changed_files: list[dict], diff_stats: dict) -> tuple[str, list[str]]:
    reasons: list[str] = []
    areas = {entry["area"] for entry in changed_files}
    paths = [entry["path"] for entry in changed_files]

    if HIGH_RISK_AREAS & areas:
        reasons.append("Touches engine, connectors, release, or workflow-definition paths.")
    if any(
        token in path
        for path in paths
        for token in ("security", "auth", "engine", "trigger", "connector")
    ):
        reasons.append("Touches security-sensitive or execution-critical files.")
    if diff_stats["insertions"] + diff_stats["deletions"] > 600:
        reasons.append("Large diff footprint.")
    if len(changed_files) > 12:
        reasons.append("Broad cross-cutting change set.")

    if reasons:
        return "high", reasons

    if UI_AREAS & areas:
        reasons.append("UI surface changed; run the frontend validation stack.")
        return "medium", reasons

    if DOC_AREAS >= areas and areas:
        reasons.append("Docs/examples only change set.")
        return "low", reasons

    if changed_files:
        reasons.append("Targeted code change set.")
        return "medium", reasons

    return "low", ["No local changes detected in the working tree."]


def recommended_checks(changed_files: list[dict], dirty: bool) -> list[str]:
    areas = {entry["area"] for entry in changed_files}
    checks = ["cargo run -p acsa-core -- validate workflows/hello.yaml"]

    if dirty:
        checks.append("git status --short --untracked-files=all")
    if HIGH_RISK_AREAS & areas or "root" in areas:
        checks.append("cargo test -p acsa-core")
    if UI_AREAS & areas:
        checks.append("cd ui && npm run lint && npm run build")
    if {"deploy", "packaging", "scripts"} & areas:
        checks.append("./scripts/package-release.sh")
    return checks


def main() -> None:
    connector_dir = Path(__file__).resolve().parent
    repo_root = connector_dir.parent.parent.resolve()

    branch = current_branch(repo_root)
    has_head = has_head_commit(repo_root)
    head_sha = run_git(repo_root, "rev-parse", "--short", "HEAD") if has_head else ""
    status_output = run_git(repo_root, "status", "--short", "--untracked-files=all")
    changed_files = [
        parse_status_line(line)
        for line in status_output.splitlines()
        if line.strip()
    ]
    area_counts = Counter(entry["area"] for entry in changed_files)
    diff_stats = parse_numstat(run_git(repo_root, "diff", "--numstat", "HEAD")) if has_head else {
        "files": 0,
        "insertions": 0,
        "deletions": 0,
    }
    risk_level, risk_reasons = compute_risk(changed_files, diff_stats)

    commits_output = (
        run_git(
            repo_root,
            "log",
            "--no-merges",
            "--pretty=format:%h%x1f%s%x1f%an",
            "-5",
        )
        if has_head
        else ""
    )
    recent_commits = []
    for line in commits_output.splitlines():
        if not line.strip():
            continue
        sha, subject, author = (line.split("\x1f", 2) + ["", ""])[:3]
        recent_commits.append({"author": author, "sha": sha, "subject": subject})

    dirty = bool(changed_files)
    payload = {
        "area_counts": dict(sorted(area_counts.items())),
        "branch": branch,
        "changed_files": changed_files,
        "diff_stats": diff_stats,
        "dirty": dirty,
        "dirty_file_count": len(changed_files),
        "head_sha": head_sha,
        "recent_commits": recent_commits,
        "recommended_checks": recommended_checks(changed_files, dirty),
        "repo_name": repo_root.name,
        "repo_root": str(repo_root),
        "risk_level": risk_level,
        "risk_reasons": risk_reasons,
        "top_areas": [area for area, _count in area_counts.most_common(3)],
    }
    json.dump(payload, sys.stdout)


if __name__ == "__main__":
    main()
