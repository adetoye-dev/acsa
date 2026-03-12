# Git Release Snapshot

Type: `git_release_snapshot`

This connector inspects the live Git checkout and returns release-oriented context: branch, head SHA, changed files, diff stats, recent commits, risk level, and suggested validation commands.

## Runtime

- Runtime: `process`
- Entry: `python3 main.py`
- Required tools: `git`, `python3`

## Quick test

```bash
cargo run -p acsa-core -- connector-test connectors/git-release-snapshot/manifest.json
```
