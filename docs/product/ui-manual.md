# UI Manual

The Acsa UI is the main product surface for building, running, and managing automations.

## Main areas

### Workflows

`Workflows` is the home surface for the product.

Use it to:

- browse workflows ordered by recent activity
- create a new workflow
- start from outcome-ready starters
- handle pending approval/manual-input tasks from paused runs

### Workflow studio

Open any workflow from the launchpad to enter the studio.

The studio provides:

- top-bar actions for save and manual run
- the workflow canvas for trigger and step layout
- in-app YAML editing
- the add-step panel
- node configuration and assistant side rails
- pending approvals through the Workflows page and execution flow

Changes are persisted through the workflow API and stored by the app.

### Executions

`Executions` is the cross-workflow run center.

Use it to:

- scan runs across workflows
- inspect the selected run graph as the main workspace
- review step payloads and logs in the right rail

### Connectors

`Connectors` is the curated capability packs library for integrations.

Use it to:

- install a small curated first-party set of capability packs (bundles of integration capabilities)
- see which installed capability packs are ready, blocked, or still need setup
- access developer-focused scaffold and test tooling via the Connectors > Developer tab
- inspect connector details only when you need them

### Credentials

`Credentials` is where API keys and secrets are managed for workflows and connectors.

## Typical workflow

1. Open `Workflows`
2. Open a workflow or start from an outcome-ready starter
3. Edit the trigger, steps, retry settings, and params in the workflow studio
4. Save the workflow
5. Run it manually or trigger it through cron or webhook
6. Use `Executions` to inspect the result
7. Use `Connectors` when a workflow needs new integration capabilities

## Save behavior

- Saves call the workflow API
- Invalid ids are rejected
- Inline secret-like values are rejected
- Workflows are stored by the app

## Run behavior

- Manual runs call `/api/workflows/{id}/run`
- Triggered workflows appear in `Executions` the same way
- Paused runs remain visible until a human task is resolved

## Working effectively

- Keep the YAML inspector clean and typed
- Use stable step ids
- Prefer small steps over large param blobs
- Use `Executions` after every structural change
- Resolve validation and setup issues before saving or running
