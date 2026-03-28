# GitHub Issue Create

Representative starter pack for creating a GitHub issue from a workflow step.

The installed connector is intentionally lightweight and performs real GitHub REST API issue creation.

## Prerequisites

- A GitHub account with access to the target repository.
- A GitHub personal access token (PAT) with the following permissions:
  - `repo` (full control of private repositories), or
  - `public_repo` (public repository access only).
- Python 3.10+ available in the runtime where connector processes execute.
- Network access from runtime to `api.github.com`.

## Installation

1. Install the GitHub Issue Create starter pack from the Connectors page in the Autonomous Cloud Service Assistant UI (ACSA UI).
2. Verify the connector appears as `github_issue_create` in the Connectors page.
3. Add your GitHub token to Credentials at `/credentials` as an environment variable or secure secret.
4. Run a connector test from the Connectors page or include a test step in a workflow.

## Usage

Invoke the connector from a workflow step to create an issue:

Security note: never hardcode GitHub tokens in workflow files. Use `${GITHUB_TOKEN}` references with environment variables or secure secrets/Credentials.

```yaml
steps:
  - id: create_issue
    type: github_issue_create
    params:
      github_token: "${GITHUB_TOKEN}"
      owner: "my-org"
      repository: "my-repo"
    inputs:
      title: "Deployment failed"
      body: "Workflow run resulted in deployment error. See logs for details."
      labels: ["bug", "urgent"]
```

## Configuration

Required parameters (in step `params`):

- `github_token` (string): GitHub personal access token for authentication.
- `owner` (string): GitHub organization or user name.
- `repository` (string): Target repository name.

Required inputs (in step `inputs`):

- `title` (string): Issue title.
- `body` (string): Issue description.

Optional inputs (in step `inputs`):

- `labels` (array of strings): Labels to apply to the issue.
- `assignees` (array of strings): GitHub usernames to assign.
- `milestone` (integer): The milestone number to attach to the issue.

## Extension Guide

This starter pack already calls the [GitHub REST API](https://docs.github.com/en/rest/issues/issues#create-an-issue). To extend integration behavior:

1. Keep using `POST https://api.github.com/repos/{owner}/{repository}/issues` with Bearer token auth.
2. Keep `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2026-03-10` headers aligned with current GitHub REST docs.
3. Extend request payload mapping from workflow `inputs`/`params` as needed.
4. Preserve structured success output (issue number, URL, ID) and structured failure JSON for automation consumers.

See also:

- [docs/connector-development.md](../../../docs/dev/connector-development.md)
- [docs/security.md](../../../docs/dev/security.md)
