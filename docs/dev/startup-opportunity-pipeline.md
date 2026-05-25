# Startup Opportunity Pipeline

An autonomous ACSA workflow that discovers funded YC startups, scrapes their websites,
analyzes their pain points with AI, generates build proposals for tools to ship to
them, and logs everything to Google Sheets.

**Purpose**: Automate the "build something useful → cold email founders" job search strategy
by systematically finding, researching, and preparing pitches for dozens of startups
while you sleep.

## Architecture

```
Trigger (Cron 2AM)
    │
    ▼
┌─────────────────────┐
│ Read Existing Leads  │◄── Google Sheets (dedup)
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ Discover Startups    │◄── YC Algolia API
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ Qualify & Filter     │ Hiring? Batch? Industry? Already processed?
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ Scrape Websites      │◄── Firecrawl API (homepage + subpages)
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ AI Pain Point        │◄── OpenAI (cynical buyer analysis)
│ Analysis             │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ Build Proposal       │◄── OpenAI (product engineer proposals)
│ Generation           │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ Format Output        │ Clean, score, build email
└────┬──────────┬─────┘
     │          │
     ▼          ▼
┌─────────┐ ┌──────────┐
│ Google   │ │ Local    │
│ Sheets   │ │ Backup   │
└────┬─────┘ └──────────┘
     │
     ▼
┌─────────┐
│ Email   │
│ Summary │
└─────────┘
```

## Prerequisites

### 1. OpenAI API Key
Already configured in your `.env.local`. Used for pain point analysis and
build proposal generation.

### 2. Firecrawl API Key

1. Go to [firecrawl.dev](https://firecrawl.dev)
2. Sign up for a free account (500 credits) or Hobby plan ($16/mo)
3. Copy your API key
4. Add to `.env.local`: `FIRECRAWL_API_KEY=fc-xxxxxxxx`

### 3. Google Sheets Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable **Google Sheets API** and **Google Drive API**
4. Go to **Credentials** → **Create Credentials** → **Service Account**
5. Download the JSON key file
6. Save it as `./credentials/google-sheets-sa.json`
7. Create a Google Sheet named "Startup Opportunity Pipeline"
8. Share it with the service account email (found in the JSON file, looks like `name@project.iam.gserviceaccount.com`) with **Editor** permissions
9. Add to `.env.local`: `GOOGLE_SHEETS_CREDENTIALS_PATH=./credentials/google-sheets-sa.json`

### 4. Install Python Dependencies

The Google Sheets connectors need `gspread` and `google-auth`:

```bash
pip install gspread google-auth
```

Or create a virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r connectors/gsheets-reader/requirements.txt
```

### 5. SMTP Email (Optional)

If you want email summaries, configure the SMTP vars in `.env.local`.
The pipeline works fine without email — it just skips the last step.

## Usage

### Validate the Workflow

```bash
cargo run -p acsa-core -- validate workflows/startup-opportunity-pipeline.yaml
```

### Manual Run

```bash
cargo run -p acsa-core -- run workflows/startup-opportunity-pipeline.yaml --db ./acsa.db
```

### Serve with API (for cron scheduling)

```bash
cargo run -p acsa-core -- serve workflows --db ./acsa.db --port 3001
```

The cron trigger (`0 2 * * *`) runs the pipeline daily at 2:00 AM.

### Run with Limited Credits (Test Mode)

Edit the workflow to set `max_leads: 2` in the `qualify_leads` step to test
with just 2 companies before running the full batch.

## Connectors

| Connector | Purpose | Dependencies |
|-----------|---------|-------------|
| `startup-discovery` | Scrapes YC directory via Algolia API | stdlib only |
| `lead-qualifier` | Filters and deduplicates leads | stdlib only |
| `website-scraper` | Scrapes websites via Firecrawl API | stdlib only |
| `output-formatter` | Structures AI output for Sheets | stdlib only |
| `gsheets-reader` | Reads existing entries for dedup | gspread, google-auth |
| `gsheets-writer` | Writes results to Google Sheets | gspread, google-auth |

## Google Sheet Columns

| Column | Description |
|--------|-------------|
| `run_date` | When this pipeline run occurred |
| `company_name` | Company name |
| `website_url` | Company website |
| `industry` | Industry/sector tags |
| `funding_raised` | Total funding (if available) |
| `batch` | YC batch (W25, S24, etc.) |
| `team_size` | Estimated team size |
| `value_proposition` | What they do (from scrape) |
| `target_market` | Their ICP/audience |
| `pain_points` | AI-identified business pain points |
| `competitor_gaps` | Where competitors outperform them |
| `proposed_tool_name` | Name of the tool to build for them |
| `problem_statement` | Problem the proposed tool solves |
| `solution_description` | What the proposed tool does |
| `mvp_tech_stack` | Recommended build stack |
| `mvp_scope` | What to build in a weekend |
| `pitch_email_draft` | Ready-to-send outreach email |
| `estimated_build_time` | Build time estimate |
| `business_impact` | Projected value to the company |
| `quality_score` | AI confidence score (1-10) |
| `status` | Tracking: new → contacted → building → shipped |

## Cost Estimation

Per run with 10 companies:

| Service | Usage | Est. Cost |
|---------|-------|-----------|
| Firecrawl | ~40 scrape credits (10 × 4 pages) | ~$0.40 |
| OpenAI (gpt-4.1-mini) | ~8K input tokens + ~8K output | ~$0.05 |
| Google Sheets API | ~12 API calls | Free |
| **Total per run** | | **~$0.45** |

At daily runs: ~$13.50/month. With Firecrawl Hobby plan ($16/mo = 3K credits),
you get ~75 full runs.

## Customization

### Change LLM Prompts

Edit the `system_prompt` fields in `analyze_pain_points` and
`generate_build_proposals` steps in the workflow YAML. The prompts are designed
to produce specific, actionable output — but you can tune them for your niche.

### Add More Sources

To add sources beyond YC directory:
1. Add source logic to `connectors/startup-discovery/main.py`
2. Add the source name to the `sources` param in the workflow

### Change Filters

Edit the `qualify_leads` step params:
- `max_leads`: How many companies per run (manages API credits)
- `batch_whitelist`: Which YC batches to include
- `industry_blacklist`: Industries to skip (e.g., `["Crypto", "Blockchain"]`)

### Change Schedule

Edit the `trigger` section in the workflow YAML:
- `"0 2 * * *"` = daily at 2 AM
- `"0 2 * * 1"` = every Monday at 2 AM
- `"0 */6 * * *"` = every 6 hours

## Troubleshooting

### Algolia API Returns Empty

The YC Algolia keys may change. The connector automatically falls back to
HTML scraping. If both fail, check the YC directory manually to verify it's
accessible.

### Firecrawl Rate Limits

Increase `delay_between_requests_ms` in the `scrape_websites` step. Default
is 2000ms (2 seconds between requests).

### Google Sheets Auth Errors

1. Verify the service account JSON file exists at the configured path
2. Verify the Google Sheet is shared with the service account email
3. Verify both Google Sheets API and Google Drive API are enabled

### LLM Output Not Parsing

The `output-formatter` connector handles various LLM output formats including
markdown code blocks and mixed text+JSON. If parsing fails, check the local
backup at `data/pipeline-runs/latest-run.json` to debug the raw output.
