# Google Sheets Append Row

Example starter pack for appending a row to Google Sheets.

It keeps the workflow contract visible in Git while remaining editable as a local connector.

## Prerequisites

- A Google account with access to the target spreadsheet.
- A Google Cloud project with the Sheets API enabled.
- A service account JSON key with write access to the spreadsheet.
- Python 3.10+ runtime with `google-api-python-client` and `google-auth` installed.

## Setup / Installation

1. Install the starter pack from the Connectors page.
2. Share the target sheet with the service account email.
3. Provide credentials in `inputs.credentials` (service account JSON object/string or OAuth token).

Optional fallback environment variables are also supported:

- `GOOGLE_SHEETS_CREDENTIALS`: raw JSON credentials content.
- `GOOGLE_SHEETS_CREDENTIALS_PATH`: path to a service-account JSON file.

<!-- markdownlint-disable-next-line MD029 -->
4. Provide `sheet_id` and optional range/sheet name in your workflow step.

## Security

**Never commit `GOOGLE_SHEETS_CREDENTIALS` or `GOOGLE_SHEETS_CREDENTIALS_PATH` to version control.** Follow these secure practices:

- Use environment variables or secrets management systems (e.g., GitHub Secrets, vault) for credentials.
- Restrict filesystem permissions on credential files (e.g., `chmod 600`).
- Avoid logging credential values; redact them from logs.
- Rotate service account keys regularly and remove old keys after rotation.
- Use the principle of least privilege: grant the service account only the minimum required permissions (`editor` on the target spreadsheet, not project-wide roles).

## Configuration

Required keys:

- `credentials` (object|string): Google credentials provided in `inputs.credentials`. Accepts a service account JSON object, a service account JSON string, or an OAuth access token string.
- `sheet_id` (string): target spreadsheet ID.
- `row` (array or object): values to append.

Credentials precedence:

- `inputs.credentials` takes priority over environment variables when both are provided.
- Environment variable fallbacks are `GOOGLE_SHEETS_CREDENTIALS` and `GOOGLE_SHEETS_CREDENTIALS_PATH`.

Optional keys:

- `sheet_name` (string, from params): optional sheet tab name.
- `sheet_range` (string, from params): optional explicit A1 range.

Decision order:

1. If both `sheet_name` and `sheet_range` are provided, `sheet_range` is used as-is.
2. If `sheet_name` is provided and `sheet_range` is omitted, `sheet_range` defaults to `{sheet_name}!A:Z`.
3. If `sheet_range` is provided and `sheet_name` is omitted, `sheet_range` is used as-is.
4. If both are omitted, `sheet_range` defaults to `<actual-first-tab-name>!A:Z` (for example, `Sheet1!A:Z`).

Workflow contract mapping:

- Inputs are validated against the connector contract in `manifest.json`.
- Outputs include `appended`, `sheet_id`, and `row` for downstream steps.

## Usage

Run with a minimal payload using an array row:

```json
{
  "inputs": {
    "credentials": "${GOOGLE_OAUTH_ACCESS_TOKEN}",
    "sheet_id": "1AbCdEfGhIjKlMnOpQrStUvWxYz",
    "row": ["2026-03-26", "deploy", "success"]
  },
  "params": {
    "sheet_name": "Events"
  }
}
```

Or provide a row as an object mapping column header names to values:

```json
{
  "inputs": {
    "credentials": {
      "type": "service_account",
      "project_id": "example-project",
      "private_key_id": "example-key-id",
      "private_key": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n",
      "client_email": "service-account@example-project.iam.gserviceaccount.com",
      "client_id": "1234567890",
      "token_uri": "https://oauth2.googleapis.com/token"
    },
    "sheet_id": "1AbCdEfGhIjKlMnOpQrStUvWxYz",
    "row": {
      "Date": "2026-03-26",
      "Action": "deploy",
      "Status": "success"
    }
  },
  "params": {
    "sheet_name": "Events"
  }
}
```

Then execute via connector test or workflow run in Acsa (the Acsa web application/dashboard).

If you omit `inputs.credentials` in payload examples, the connector will use `GOOGLE_SHEETS_CREDENTIALS` or `GOOGLE_SHEETS_CREDENTIALS_PATH` when available.

## What Is The Workflow Contract?

The workflow contract is the connector input/output shape declared in `manifest.json`.
It defines what callers must provide (`inputs`) and what downstream steps can rely on
(`outputs`), and allows runtime validation before connector execution.
