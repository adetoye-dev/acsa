# Acsa Demo: AI News Intelligence With Email Delivery

This is the strongest current Acsa demo because it completes a real daily automation loop:

1. collect live AI updates from public sources
2. rank and synthesize what matters
3. archive the brief locally
4. deliver it by email

The workflow lives in `workflows/` on purpose so it shows up in the editor immediately.

## What the workflow does

1. Collects AI updates from official feeds plus Hacker News developer signal
2. Normalizes, deduplicates, and ranks the strongest items
3. Uses the built-in `llm_completion` node with OpenAI to write a concise daily brief
4. Writes the source context to `data/demo/output/ai-news-intelligence-context.json`
5. Writes the final markdown brief to `data/demo/output/ai-news-intelligence-brief.md`
6. Emails the same brief to the configured recipient over SMTP

## Run it

From the repository root:

```bash
cp .env.local.example .env.local
# edit .env.local with your real OpenAI and SMTP values
cargo run -p acsa-core -- validate workflows/ai-news-intelligence-demo.yaml
cargo run -p acsa-core -- run workflows/ai-news-intelligence-demo.yaml --db ./acsa-demo.db --json
cat data/demo/output/ai-news-intelligence-brief.md
```

`acsa-core` loads `.env.local` automatically when you run from the repository root. If you also
export values in your shell, those exported values take precedence.

Expected runtime is well under five minutes on a normal developer machine.

## Switch it to daily mode

Change the trigger in `workflows/ai-news-intelligence-demo.yaml` from:

```yaml
trigger:
  type: manual
```

to:

```yaml
trigger:
  type: cron
  schedule: "0 0 8 * * *"
```

That schedule runs every day at 08:00 server time. Keep the manual trigger in demos and videos.

## Offline connector-only checks

These two checks run without internet access:

```bash
cargo run -p acsa-core -- connector-test \
  connectors/ai-news-collector/manifest.json \
  --inputs connectors/ai-news-collector/sample-input.json \
  --params connectors/ai-news-collector/sample-params.json

cargo run -p acsa-core -- connector-test \
  connectors/ai-news-brief-renderer/manifest.json \
  --inputs connectors/ai-news-brief-renderer/sample-input.json
```

## Files

- Workflow: `workflows/ai-news-intelligence-demo.yaml`
- Connectors:
  - `connectors/ai-news-collector/`
  - `connectors/ai-news-brief-renderer/`
  - `connectors/smtp-email-delivery/`
- Example output: `examples/demo/example-output/ai-news-intelligence-brief.md`
