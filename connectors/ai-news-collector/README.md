# AI News Collector

This connector gathers AI updates from public RSS feeds plus Hacker News, normalizes them into one shape, deduplicates overlapping stories, ranks them by practical impact, and prepares the prompt used by the built-in `llm_completion` step.

The connector-level runtime limit is 60 seconds. Source fetches remain configurable through the existing `timeout_secs` param, which controls per-request network timeouts for RSS and Hacker News fetches.

## Live usage

The flagship workflow uses live public sources directly from the internet.

## Offline connector test

Optional hardening dependency:

```bash
python3 -m pip install -r connectors/ai-news-collector/requirements.txt
```

The connector works without `defusedxml`; if it is not installed, Acsa falls back to Python's
standard XML parser after rejecting feeds that contain DTD or entity declarations.

The connector also supports local fixture files so it can be tested without network access:

```bash
cargo run -p acsa-core -- connector-test \
  connectors/ai-news-collector/manifest.json \
  --inputs connectors/ai-news-collector/sample-input.json \
  --params connectors/ai-news-collector/sample-params.json
```

The fixture-driven test path verifies RSS normalization, Hacker News normalization, deduplication, and ranking without depending on live feed availability.
