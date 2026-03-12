# Release Brief Renderer

Type: `release_brief_renderer`

This connector turns live release context into a markdown brief for handoff, review, or release prep.

## Runtime

- Runtime: `process`
- Entry: `python3 main.py`
- Required tools: `python3`

## Quick test

```bash
cargo run -p acsa-core -- connector-test connectors/release-brief-renderer/manifest.json --inputs connectors/release-brief-renderer/sample-input.json
```
