# Contributing to Acsa

Thanks for contributing to Acsa. This project is developed as a local-first, security-conscious automation engine, so changes are expected to be small, testable, and documented.

## Ground rules

- Follow the blueprint phase boundaries when working on roadmap items
- Prefer small, reviewable pull requests
- Add tests for core behavior changes
- Update docs when behavior, commands, or configuration changes
- Do not commit secrets, `.env` files, or generated database files
- Avoid `unsafe` Rust unless it is strictly necessary and reviewed explicitly

## Development setup

Prerequisites:

- Rust toolchain
- Node.js 22+
- npm 11+

Bootstrap:

```bash
cargo test --workspace
cd ui
npm install
npm run lint
```

## Useful commands

Rust:

```bash
cargo fmt --all
cargo test --workspace
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo run -p acsa-core -- --version
```

UI:

```bash
cd ui
npm run lint
npm run build
```

## Pull request expectations

Every pull request should:

- explain what changed and why
- reference related issues when applicable
- include tests or explain why tests were not needed
- update documentation when user-facing behavior changes
- keep unrelated refactors out of scope

## Commit sign-off and licensing

Contributors are expected to sign off commits with the Developer Certificate of Origin.

Use:

```bash
git commit -s
```

By contributing, you agree that your work is licensed under the repository license, Apache-2.0.

## Review checklist

Before opening a pull request:

1. Run the Rust checks
2. Run the UI checks if you touched `ui/`
3. Verify any new docs links or commands
4. Confirm no secrets or local artifacts are included
5. Summarize tradeoffs or known follow-up work in the PR description
