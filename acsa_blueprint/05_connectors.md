# Phase 5: Connector SDK and Plug‑in Architecture

This phase defines how external integrations can extend Acsa.  The connector
SDK must make it easy for developers to write new nodes without modifying the
core engine.  Two extension models are provided: **subprocess connectors** for
rapid scripting and **WebAssembly connectors** for performance and isolation.

## 1. Directory Layout

All third‑party connectors live in the `connectors/` folder.  Each connector
resides in its own subdirectory:

```
connectors/
  ├─ http_request/         # built‑in connectors can live here too
  │  ├─ manifest.json
  │  └─ http_request.wasm
  ├─ slack_notifier/
  │  ├─ manifest.json
  │  └─ main.py
  └─ ...
```

The engine scans this folder at startup and loads all connectors based on
their `manifest.json` files.  Connectors can be packaged with additional
resources (e.g., `package.json`, compiled binaries), but only `manifest.json`
and the primary entrypoint (WASM or script) are required.

## 2. Manifest Specification

Create a `manifest.json` schema that describes a connector.  At minimum
include:

- `name` (string): human‑readable name of the connector.
- `type` (string): unique type identifier used in workflow YAML (e.g.,
  `slack_webhook`).
- `runtime` (enum): `"wasm"` or `"process"`.
- `entry` (string): path to the `.wasm` file or executable relative to the
  manifest.
- `inputs` (array of strings): list of required input keys.
- `outputs` (array of strings): list of output keys that the connector
  produces.
- `limits` (object): optional memory (MB) and timeout (milliseconds) limits.

Here is an example manifest for a WASM connector:

```json
{
  "name": "Slack Notifier",
  "type": "slack_webhook",
  "runtime": "wasm",
  "entry": "slack_webhook.wasm",
  "inputs": ["webhook_url", "message"],
  "outputs": [],
  "limits": { "memory": 64, "timeout": 10000 }
}
```

## 3. Subprocess Connectors

Subprocess connectors are ideal for quick integrations and scripts.  The
engine launches the specified command as a child process, writes JSON input
to its stdin, and reads JSON output from stdout.  Follow these rules:

1. **Command specification.**  In the manifest, set `runtime` to `process`
   and `entry` to a shell command (e.g., `python3 main.py`).  The engine will
   resolve the path relative to the connector directory.

2. **Data exchange.**  The engine passes a JSON object to the process with
   the following structure:
   
   ```json
   {
     "inputs": { /* upstream data */ },
     "params": { /* workflow parameters */ },
     "secrets": { /* environment secrets */ }
   }
   ```
   
   The process must read from stdin, parse the JSON, perform its task, and
   write a JSON object to stdout containing the outputs defined in the
   manifest.

3. **Language support.**  Scripts can be written in any language available on
   the host (Python, Bash, Node, etc.).  Provide templates for Python and
   JavaScript connectors in the `examples/` folder.  Encourage the use of
   virtual environments and pinned dependencies to avoid conflicts.

4. **Security considerations.**  The engine should launch subprocesses with
   restricted privileges.  Consider running them under a separate user ID or
   using Linux namespaces/containers.  Limit CPU time and memory via OS
   primitives (e.g., `setrlimit`).  Validate output JSON to prevent
   injection attacks or path traversal.

## 4. WebAssembly Connectors

Use WebAssembly for high‑performance or untrusted code.  This model isolates
connectors inside a sandbox, making it safe to run arbitrary code.

1. **Compile the plugin.**  Developers can write their connector in Rust,
   AssemblyScript, Go (via TinyGo), or other languages that compile to WASM.
   The connector must export a function named `execute` taking a pointer to a
   JSON string and returning a pointer/length to a JSON string.  The JSON
   format should match the input structure shown above.

2. **Build tooling.**  Provide a starter template (in `examples/wasm-plugin/`)
   with a `Cargo.toml` configured for `wasm32-wasi` and an `extism-pdk` crate
   that simplifies writing WASM plugins.  Include a build script that
   produces a `.wasm` file ready for the engine.

3. **Limits and host functions.**  Configure memory and timeouts per plugin
   via the `limits` field in the manifest.  Do not expose filesystem or
   network host functions by default.  Provide safe host functions for
   logging (`log::info`) and secret retrieval if necessary.

4. **Versioning.**  Encourage developers to version their WASM plugins.  The
   manifest can include a `version` field.  The engine should verify plugin
   versions to support upgrades and rollback.

## 5. Developer Experience

1. **Generator script.**  Write a CLI command (e.g., `acsa new connector`)
   that scaffolds a new connector.  It should prompt for the connector name,
   type, runtime, and create a directory with a stub `manifest.json` and
   template code.

2. **Documentation.**  Provide clear docs and examples for creating both
   subprocess and WASM connectors.  Explain how to handle inputs, emit
   outputs, and test connectors locally using the CLI.

3. **Testing harness.**  Offer a test harness that runs connectors with
   sample inputs and validates their outputs.  This encourages contributors
   to write reliable connectors before submitting pull requests.

## 6. Guardrails and Policies

1. **Review required.**  All new connectors should undergo code review by
   maintainers before being merged into the official repository.  Reviewers
   should check for security issues, license compatibility, and adherence to
   the manifest schema.

2. **Sandbox by default.**  Prefer WASM connectors for untrusted code.  Use
   subprocess connectors only when a WASM implementation is impractical.

3. **Resource limits.**  Enforce memory and timeouts at runtime as specified
   in the manifest.  Kill misbehaving connectors and surface an error to the
   workflow engine.

4. **Dependency isolation.**  For subprocess connectors, avoid globally
   installed packages.  Recommend bundling dependencies with the connector or
   using isolated virtual environments.

Completing this phase will enable a vibrant ecosystem of connectors
contributed by the community while keeping the core engine lean and secure.
