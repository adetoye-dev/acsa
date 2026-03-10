# Connector Development

Acsa connectors extend the node registry with externally packaged integrations. The current runtime supports subprocess connectors and Extism-backed WASM connectors.

## Connector manifest

Each connector is described by `manifest.json`.

Current fields:

- `name`
- `type`
- `runtime`
- `entry`
- `version`
- `inputs`
- `outputs`
- `limits.timeout`
- `limits.memory`
- `allowed_env`
- `allowed_hosts`
- `allowed_paths`
- `enable_wasi`

Example:

```json
{
  "name": "sample-echo",
  "type": "sample_echo",
  "runtime": "process",
  "entry": "sh main.sh",
  "version": "0.1.0",
  "inputs": ["message"],
  "outputs": ["echoed"],
  "allowed_env": ["SAMPLE_API_TOKEN"],
  "limits": {
    "timeout": 5000
  }
}
```

## Runtime types

### Process

Process connectors:

- run as child processes
- receive JSON on stdin
- return JSON on stdout
- inherit only `PATH` plus manifest-approved values from `allowed_env`
- are killed on timeout
- must use either a relative executable or an approved launcher such as `sh`, `bash`, `python3`, or `node`

Use when:

- you need an integration quickly
- you want to prototype outside Rust or WASM
- you can accept host-level process execution constraints

### WASM

WASM connectors:

- are loaded through Extism
- expose an `execute` function
- support manifest-driven timeout and memory settings
- support optional host allowlists via `allowed_hosts`
- support optional filesystem mappings via `allowed_paths` when `enable_wasi` is set
- are the preferred path for untrusted or third-party extension logic because sandboxing is stronger than subprocess execution
- are disabled by default and require `ACSA_ENABLE_WASM_CONNECTORS=1`; keep this global flag off in production unless you explicitly need WASM support because Extism-based execution adds runtime/operational overhead and remains a stricter capability surface to operate

Operational note: `ACSA_ENABLE_WASM_CONNECTORS=1` is a global runtime gate for all WASM connectors. Keep it disabled by default in production, then enable it only in environments where the specific WASM connectors you trust and need are deployed.

Use when:

- you need stronger isolation than a subprocess
- you want portable connector artifacts
- you want tighter runtime control

## Connector payload contract

Acsa sends a JSON object shaped like this:

```json
{
  "inputs": {},
  "params": {},
  "secrets": {}
}
```

Rules:

- `inputs` comes from upstream workflow data
- `params` comes from the workflow step configuration
- `secrets` is derived from `*_env` style references in params
- required input keys and output keys are validated against the manifest

## Secrets

Do not inline credentials in connector params. Use environment references and let the engine resolve them into the `secrets` object that the connector receives.

## Scaffolding and local testing

Create a connector:

```bash
cargo run -p acsa-core -- connector-new sample-echo --type sample_echo --runtime process --dir ./connectors
```

Test a manifest directly:

```bash
cargo run -p acsa-core -- connector-test ./connectors/sample-echo/manifest.json --inputs ./connectors/sample-echo/sample-input.json
```

Reference examples:

- [examples/process-connector](../examples/process-connector)
- [examples/wasm-plugin](../examples/wasm-plugin)

## Patterns

Recommended subprocess pattern:

1. Read stdin fully
2. Parse JSON once
3. Validate required params early
4. Do the integration work
5. Return a single JSON object with stable keys

Recommended WASM pattern:

1. Keep the exported `execute` function small
2. Avoid hidden mutable global state
3. Return plain JSON strings
4. Treat memory and timeout limits as hard operational boundaries

## Security considerations

- Process connectors should be treated as trusted host code
- WASM connectors are safer for third-party code, but still need strict limits
- Do not enable WASM connectors in production unless you explicitly need them
- Always validate incoming params and output keys
- Avoid reading arbitrary filesystem paths
- Avoid inheriting the full parent environment
- Keep network access narrow and explicit in the connector logic

## Release guidance

- Version connector manifests
- Keep output schemas stable
- Add fixture-based tests for malformed input and timeout behavior
- Document required environment variables next to the connector
