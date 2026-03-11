# UI Manual

The Acsa UI is a lightweight editor on top of the engine API. It is not a separate workflow source of truth. Every change maps back to the YAML model.

## Main areas

### Workflow explorer

Use the left-side explorer to:

- browse workflows
- open a workflow
- create a workflow
- duplicate a workflow
- delete a workflow

Invalid files are surfaced separately so bad YAML does not disappear silently.

### Connector manager

The connector manager sits under the workflow explorer and lets you:

- inspect loaded connector manifests
- see which connectors are blocked by the WASM runtime flag
- scaffold a new process or WASM connector into `connectors/`
- run a connector's sample input without leaving the editor
- spot invalid connector manifests without breaking the rest of the catalog

### Top bar

The top bar provides:

- refresh
- save
- manual run
- last action feedback
- last run summary

### Canvas

The center canvas uses React Flow to display:

- the trigger node
- step nodes
- graph edges
- layout controls and a minimap

You can reposition nodes visually. Edge edits update downstream `next` links.

### Inspector

The inspector is the detailed editing surface for:

- workflow name
- trigger type
- trigger details YAML
- selected step id
- selected step type
- retry attempts
- retry backoff
- timeout
- params YAML

Changes are applied against the in-memory workflow document and then persisted on save.

### Human task inbox

The inbox lists pending:

- approvals
- manual input tasks

Resolving a task resumes the paused run through the engine API.

### Run history panel

The observability panel shows:

- summary metrics
- workflow and status filters
- recent runs
- selected run timeline
- step payloads
- log level and text filtering

## Typical workflow

1. Open or create a workflow
2. Set the trigger type and details
3. Add steps from the catalog
4. Scaffold or test connectors from the left rail when you need a new integration
5. Edit params and retry or timeout settings
6. Save the workflow
7. Run it manually or trigger it through cron or webhook
8. Use run history and logs to inspect the result

## Save behavior

- Saves call the workflow API
- Invalid ids are rejected
- Inline secret-like values are rejected
- YAML remains the persisted representation on disk

## Run behavior

- Manual runs call `/api/workflows/{id}/run`
- Triggered workflows appear in run history the same way
- Paused runs remain visible until a human task is resolved

## Working effectively

- Keep the YAML inspector clean and typed
- Use stable step ids
- Prefer small steps over large param blobs
- Use the run history panel after every structural change
- Resolve validation errors in the inspector before saving
