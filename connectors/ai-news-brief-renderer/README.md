# AI News Brief Renderer

This connector turns the normalized news context plus the OpenAI draft into one final markdown/email body pair.

## Test it locally

```bash
cargo run -p acsa-core -- connector-test \
  connectors/ai-news-brief-renderer/manifest.json \
  --inputs connectors/ai-news-brief-renderer/sample-input.json
```
