# API Reference

Acsa exposes a local HTTP API from `acsa-core serve`. Unless overridden, the engine listens on `http://127.0.0.1:3001`.

## Response conventions

- Success:
  - JSON payloads or plain text for `/metrics`
- Errors:
  - `{"error":"..."}` with an HTTP status code

Common status codes:

- `200 OK`
- `201 Created`
- `204 No Content`
- `400 Bad Request`
- `404 Not Found`
- `500 Internal Server Error`

## Health and metrics

### `GET /healthz`

Returns:

```json
{
  "status": "ok"
}
```

### `GET /metrics`

Returns Prometheus-style metrics text for workflow runs and step execution.

## Node catalog

### `GET /api/node-catalog`

Returns trigger and step type metadata for the UI.

Example:

```bash
curl http://127.0.0.1:3001/api/node-catalog
```

## Workflow inventory

### `GET /api/workflows`

Returns workflow summaries plus any invalid files discovered in the workflows directory.

### `POST /api/workflows`

Creates a workflow from YAML.

Request body:

```json
{
  "id": "daily-report",
  "yaml": "version: v1\nname: daily-report\ntrigger:\n  type: manual\nsteps: []\n"
}
```

Notes:

- `id` is optional. If omitted, Acsa derives it from the workflow name.
- Inline secret-like values are rejected. Use environment references instead.

### `GET /api/workflows/{workflow_id}`

Returns the stored YAML plus a summary.

### `PUT /api/workflows/{workflow_id}`

Updates the workflow YAML.

Request body:

```json
{
  "yaml": "version: v1\nname: daily-report\ntrigger:\n  type: manual\nsteps: []\n"
}
```

### `DELETE /api/workflows/{workflow_id}`

Deletes the workflow file.

### `POST /api/workflows/{workflow_id}/duplicate`

Duplicates a workflow to a new id.

Request body:

```json
{
  "target_id": "daily-report-copy"
}
```

### `POST /api/workflows/{workflow_id}/run`

Starts a manual run.

Request body:

```json
{
  "payload": {
    "source": "api",
    "ticket_id": "INC-1024"
  }
}
```

Response shape:

```json
{
  "completed_steps": 1,
  "pending_tasks": [],
  "run_id": "uuid",
  "status": "success",
  "workflow_name": "manual-demo"
}
```

## Run history

### `GET /api/runs`

Query parameters:

- `page`
- `page_size`
- `status`
- `workflow_name`

Example:

```bash
curl "http://127.0.0.1:3001/api/runs?page=1&page_size=12&status=success"
```

Response shape:

```json
{
  "page": 1,
  "page_size": 12,
  "runs": [],
  "total": 0
}
```

### `GET /api/runs/{run_id}`

Returns:

- run metadata
- step attempts with input and output payloads
- related human tasks

### `GET /api/runs/{run_id}/logs`

Query parameters:

- `page`
- `page_size`
- `level`
- `search`

Example:

```bash
curl "http://127.0.0.1:3001/api/runs/RUN_ID/logs?level=error&search=timeout"
```

## Human tasks

### `GET /human-tasks`

Lists pending human-review work across runs.

### `POST /human-tasks/{task_id}/resolve`

Resolves a paused human task and resumes the run.

Approval payload:

```json
{
  "approved": true
}
```

Manual input payload:

```json
{
  "value": "ship it"
}
```

## Webhooks

### `POST /hooks/...`

Webhook workflows are mounted dynamically based on workflow configuration.

Example:

```bash
curl \
  -X POST http://127.0.0.1:3001/hooks/incoming-review \
  -H "content-type: application/json" \
  -H "x-acsa-webhook-token: change-me" \
  -d '{"priority":"urgent","ticket_id":"INC-1024"}'
```

Authentication:

- The shared secret must come from `secret_env`, `token_env`, or `secrets_env`
- The header name defaults to `x-acsa-webhook-token` unless the workflow overrides it

## Axios example

```ts
import axios from "axios";

const client = axios.create({
  baseURL: "http://127.0.0.1:3001"
});

const workflow = await client.get("/api/workflows/manual-demo");
const run = await client.post("/api/workflows/manual-demo/run", {
  payload: {
    source: "axios"
  }
});

console.log(workflow.data, run.data);
```

## Security notes

- Workflow writes reject likely secrets in inline form
- Run detail payloads can be hidden with `ACSA_LOG_PAYLOADS=0`
- Webhook authentication should always use environment-managed secrets
- Treat logs and run payloads as operational data with retention controls
