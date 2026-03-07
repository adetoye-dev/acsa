# AGENT_RULES.md
Rules for AI agents working on the Acsa repository.

## Core Principles
1. Never skip phases defined in the blueprint.
2. Always read blueprint files before implementing features.
3. Always ask for approval before proceeding to the next phase.
4. Prefer simple, maintainable solutions over complex ones.
5. Security rules override convenience.

## Security Rules
- Never commit secrets, API keys, or tokens.
- Always validate YAML, JSON, and external inputs.
- Plugins must be sandboxed.
- Redact sensitive values from logs.
- Enforce timeouts and resource limits for all external tasks.

## Development Rules
- Write tests for all core logic.
- Keep commits small and logically grouped.
- Update documentation when introducing new features.
- Avoid unsafe Rust unless absolutely required.

## Review Policy
At the end of every phase the agent must:
- Summarize changes
- List files created/modified
- Provide test results
- Ask for approval before continuing.
