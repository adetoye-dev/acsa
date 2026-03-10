# Third-Party Licenses

Acsa is released under Apache-2.0. The project depends on third-party Rust crates and NPM packages with licenses that are compatible with that distribution model.

## Direct Rust dependencies

| Dependency | License |
| --- | --- |
| async-trait | MIT OR Apache-2.0 |
| axum | MIT |
| chrono | MIT OR Apache-2.0 |
| cron | MIT OR Apache-2.0 |
| extism | BSD-3-Clause |
| petgraph | MIT OR Apache-2.0 |
| reqwest | MIT OR Apache-2.0 |
| serde | MIT OR Apache-2.0 |
| serde_json | MIT OR Apache-2.0 |
| serde_yaml | MIT OR Apache-2.0 |
| shlex | MIT OR Apache-2.0 |
| sqlx | MIT OR Apache-2.0 |
| subtle | BSD-3-Clause |
| thiserror | MIT OR Apache-2.0 |
| tokio | MIT |
| tracing | MIT |
| tracing-subscriber | MIT |
| uuid | Apache-2.0 OR MIT |

## Direct UI dependencies

| Dependency | License |
| --- | --- |
| @xyflow/react | MIT |
| axios | MIT |
| next | MIT |
| react | MIT |
| react-dom | MIT |
| yaml | ISC |

## Release process note

This file is a maintained snapshot of direct dependencies. The full transitive bill of materials should be regenerated as part of each release candidate and stable release process.

Recommended release checks:

- Rust:
  - `cargo audit`
  - `cargo metadata`
- Node:
  - `npm audit`
  - `npm ls`

If a future release adds dependencies with terms that are not clearly Apache-2.0 compatible, that release should not ship until the dependency choice is reviewed.
