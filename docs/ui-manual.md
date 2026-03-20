# UI Manual

The Acsa UI is a product shell on top of the engine API. It is not a separate workflow source of truth. Saved YAML is still what runs.

## Main areas

### Workflows

`Workflows` is the home surface for the product.

Use it to:

- continue where you left off with recently opened workflows
- start from outcome-ready starters
- browse the compact full workflow inventory
- spot invalid YAML files near the inventory instead of losing them silently

Starter workflows open as local drafts first. They do not write workflow files until you save.

### Workflow studio

Open any workflow from the launchpad to enter the studio.

The studio provides:

- top-bar actions for refresh, save, and manual run
- the workflow canvas for trigger and step layout
- the capability library for adding new steps
- the inspector for editing trigger and selected-step details
- preview of the generated workflow YAML
- the human-task inbox for paused approvals and manual input

Changes are applied against the in-memory workflow document and then persisted on save.

### Executions

`Executions` is the cross-workflow run center.

Use it to:

- scan runs across workflows
- inspect the selected run graph as the main workspace
- review step payloads and logs in the right rail
- understand when a run is rendering from a fallback snapshot

### Connectors

`Connectors` is the curated starter-pack library for integration packs.
`Connectors` is the curated capability-pack library for integrations.

Use it to:

- install a small curated first-party set of integration capabilities
- see which installed capability packs are ready, blocked, or still need setup
- keep local scaffold/test tooling behind the secondary developer section
- inspect low-level manifest and runtime details only when you need them

## Typical workflow

1. Open `Workflows`
2. Resume a recent workflow or start from an outcome-ready starter
3. Edit the trigger, steps, retry settings, and params in the workflow studio
4. Save the workflow
5. Run it manually or trigger it through cron or webhook
6. Use `Executions` to inspect the result
7. Use `Connectors` when a workflow needs new integration capabilities

## Save behavior

- Saves call the workflow API
- Invalid ids are rejected
- Inline secret-like values are rejected
- YAML remains the persisted representation on disk

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
