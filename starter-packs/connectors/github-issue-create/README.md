# GitHub Issue Create

Representative starter pack for creating a GitHub issue from a workflow step.

The installed connector is intentionally lightweight and can be extended with a real GitHub API integration later.

## Prerequisites

- A GitHub account with access to the target repository.
- A GitHub personal access token (PAT) with the following permissions:
  - `repo` (full control of private repositories), or
  - `public_repo` (public repository access only).
- Python 3.10+ available in the runtime where connector processes execute.
- Network access from runtime to `api.github.com`.

## Installation

1. Install the GitHub Issue Create starter pack from the Connectors page in the Acsa UI.
2. Verify the connector appears as `github_issue_create` in your local connector inventory.
3. Add your GitHub token to Credentials at `/credentials` as an environment variable or secure secret.
4. Run a connector test from the Connectors page or include a test step in a workflow.

## Usage

Invoke the connector from a workflow step to create an issue:

```yaml
steps:
  - id: create_issue
    type: github_issue_create
    params:
      token: "${GITHUB_TOKEN}"
      owner: "my-org"
      repository: "my-repo"
    inputs:
      title: "Deployment failed"
      body: "Workflow run resulted in deployment error. See logs for details."
      labels: ["bug", "urgent"]
```

## Configuration

Required parameters (in step `params`):

- `token` (string): GitHub personal access token for authentication.
- `owner` (string): GitHub organization or user name.
- `repository` (string): Target repository name.

Required inputs (in step `input`):

- `title` (string): Issue title.
- `body` (string): Issue description.

Optional inputs (in step `input`):

- `labels` (array of strings): Labels to apply to the issue.
- `assignees` (array of strings): GitHub usernames to assign.
- `milestone` (string): Milestone identifier or number.

## Extension Guide

This starter pack is currently a scaffold with mock output. To implement real GitHub API integration:

1. Replace the mock implementation in `main.py` with calls to the [GitHub REST API](https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28#create-an-issue).
2. Use the GitHub personal access token in `params.token` for Bearer token authentication.
3. Construct the API endpoint: `POST https://api.github.com/repos/{owner}/{repository}/issues`.
4. Parse the workflow step inputs and params to build the request payload.
5. Return the created issue details (issue number, URL, ID) in the connector output.
6. Handle errors (invalid token, repository not found, permission denied) by printing error JSON and exiting with code 1.

See also:

- [docs/connector-development.md](../../../docs/connector-development.md)
- [docs/security.md](../../../docs/security.md)
