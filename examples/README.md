# Examples

This directory now includes:

- `demo/`: the strongest local-first Acsa demo, turning live AI news sources into an emailed intelligence brief plus a local archive
- `workflow-samples/`: legacy sample workflows kept out of the UI-facing `workflows/` directory
- `process-connector/`: a subprocess connector sample that can be exercised with `acsa-core connector-test`
- `wasm-plugin/`: a starter Extism/WASM connector template

Fastest path:

```bash
cargo run -p acsa-core -- validate workflows/ai-news-intelligence-demo.yaml
cargo run -p acsa-core -- connector-test
```

Use these alongside the workflow samples in `workflows/` and the `connector-new` command when building new integrations. New connector scaffolds include source files plus `sample-input.json`.

For connector packaging and security guidance, see `docs/dev/connector-development.md`.
