# Examples

This directory now includes:

- `process-connector/`: a subprocess connector sample that can be exercised with `acsa-core connector-test`
- `wasm-plugin/`: a starter Extism/WASM connector template

Fastest path:

```bash
cargo run -p acsa-core -- connector-test
```

Use these alongside the workflow samples in `workflows/` and the `connector-new` command when building new integrations. New connector scaffolds also include a starter `README.md` and `sample-input.json`.

For connector packaging and security guidance, see `docs/connector-development.md`.
