#!/usr/bin/env python3

"""Website Scraper connector for ACSA.

Iterates through qualified leads and scrapes each company's website
using the Firecrawl API to get clean, LLM-ready markdown content.
Builds an analysis prompt for downstream AI processing.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape"
USER_AGENT = "Acsa Startup Pipeline/1.0"
DEFAULT_DELAY_MS = 2000
DEFAULT_TIMEOUT_SECS = 30
MAX_HOMEPAGE_CHARS = 3000
MAX_SUBPAGE_CHARS = 1500
MAX_PRICING_CHARS = 1000
MAX_CAREERS_CHARS = 1000
SUBPAGE_PATHS = ["about", "pricing", "careers", "press", "news"]


def load_payload() -> dict:
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError as error:
        raise SystemExit(f"invalid connector payload: {error}")


def truncate(text: str, limit: int) -> str:
    """Truncate text to a character limit, preserving word boundaries."""
    if not text or len(text) <= limit:
        return text or ""
    # Find last space before limit
    cut = text[:limit].rfind(" ")
    if cut < limit // 2:
        cut = limit
    return text[:cut].rstrip() + "..."


def normalize_base_url(url: str) -> str:
    """Ensure URL has scheme and normalize trailing slashes."""
    url = url.strip()
    if not url:
        return ""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    parsed = urllib.parse.urlparse(url)
    return urllib.parse.urlunparse((
        parsed.scheme,
        parsed.netloc,
        parsed.path.rstrip("/"),
        "",
        "",
        "",
    ))


def scrape_url(url: str, api_key: str, timeout_secs: int) -> tuple[str, str | None]:
    """Call Firecrawl API to scrape a single URL.

    Returns (markdown_content, error_message_or_none).
    """
    if not api_key:
        return "", "FIRECRAWL_API_KEY not set"

    body = json.dumps({
        "url": url,
        "formats": ["markdown"],
    }).encode("utf-8")

    request = urllib.request.Request(
        FIRECRAWL_SCRAPE_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout_secs) as response:
            result = json.loads(response.read().decode("utf-8", errors="replace"))

        if result.get("success", False):
            data = result.get("data", {})
            markdown = data.get("markdown", "")
            return markdown, None
        else:
            error_msg = result.get("error", "unknown Firecrawl error")
            return "", str(error_msg)

    except urllib.error.HTTPError as error:
        error_body = ""
        try:
            error_body = error.read().decode("utf-8", errors="replace")[:200]
        except Exception:
            pass
        return "", f"HTTP {error.code}: {error_body or error.reason}"

    except urllib.error.URLError as error:
        return "", f"URL error: {error.reason}"

    except Exception as error:
        return "", f"unexpected error: {error}"


def scrape_company(
    company: dict,
    api_key: str,
    delay_ms: int,
    scrape_subpages: bool,
    timeout_secs: int,
) -> dict:
    """Scrape a company's website and return enriched company data."""
    base_url = normalize_base_url(company.get("url", ""))
    if not base_url:
        company["website_content"] = ""
        company["subpage_content"] = {}
        company["scrape_status"] = "failed"
        company["scrape_error"] = "no URL provided"
        return company

    # Scrape homepage
    homepage_content, homepage_error = scrape_url(base_url, api_key, timeout_secs)

    if homepage_error:
        company["website_content"] = ""
        company["subpage_content"] = {}
        company["scrape_status"] = "failed"
        company["scrape_error"] = homepage_error
        return company

    company["website_content"] = homepage_content
    company["subpage_content"] = {}
    company["scrape_status"] = "ok"
    company["scrape_error"] = None

    # Scrape subpages if enabled
    if scrape_subpages:
        partial = False
        for subpage in SUBPAGE_PATHS:
            time.sleep(delay_ms / 1000.0)
            subpage_url = f"{base_url}/{subpage}"
            content, error = scrape_url(subpage_url, api_key, timeout_secs)
            if content:
                company["subpage_content"][subpage] = content
            elif error:
                # Don't fail the whole company for a missing subpage
                company["subpage_content"][subpage] = ""
                partial = True

        if partial and not company["subpage_content"].get("about"):
            company["scrape_status"] = "partial"

    return company


def build_analysis_prompt(scraped_companies: list[dict]) -> str:
    """Build a structured prompt for the downstream LLM analysis step."""
    lines = [
        "Analyze the following companies. For each company, identify specific, "
        "actionable pain points, product weaknesses, and opportunities for building "
        "a useful tool or integration. Be a cynical buyer, not a cheerleader.",
        "",
        "Output your analysis as a JSON array with one object per company:",
        '[{"company_name": "...", "what_they_do": "...", "target_market": "...", '
        '"pain_points": ["..."], "product_gaps": ["..."], "competitor_weaknesses": ["..."], '
        '"tech_stack_signals": ["..."], "opportunity_summary": "..."}]',
        "",
    ]

    for idx, company in enumerate(scraped_companies, start=1):
        name = company.get("name", "Unknown")
        url = company.get("url", "")
        industry = company.get("industry", [])
        if isinstance(industry, list):
            industry = ", ".join(industry)
        one_liner = company.get("one_liner", "")
        long_desc = company.get("long_description", "")
        homepage = truncate(company.get("website_content", ""), MAX_HOMEPAGE_CHARS)
        subpages = company.get("subpage_content", {})
        about = truncate(subpages.get("about", ""), MAX_SUBPAGE_CHARS)
        pricing = truncate(subpages.get("pricing", ""), MAX_PRICING_CHARS)
        careers = truncate(subpages.get("careers", ""), MAX_CAREERS_CHARS)
        press = truncate(subpages.get("press", ""), MAX_SUBPAGE_CHARS)
        news = truncate(subpages.get("news", ""), MAX_SUBPAGE_CHARS)

        lines.append(f"=== COMPANY {idx}: {name} ===")
        lines.append(f"URL: {url}")
        if industry:
            lines.append(f"Industry: {industry}")
        if one_liner:
            lines.append(f"One-liner: {one_liner}")
        if long_desc:
            lines.append(f"Description: {truncate(long_desc, 500)}")
        lines.append("")

        if homepage:
            lines.append("--- Homepage Content ---")
            lines.append(homepage)
            lines.append("")
        else:
            lines.append("--- Homepage Content ---")
            lines.append("[Could not scrape homepage; analyze based on YC description above]")
            lines.append("")

        if about:
            lines.append("--- About Page ---")
            lines.append(about)
            lines.append("")

        if pricing:
            lines.append("--- Pricing Page ---")
            lines.append(pricing)
            lines.append("")

        if careers:
            lines.append("--- Careers Page ---")
            lines.append(careers)
            lines.append("")

        if press:
            lines.append("--- Press Page ---")
            lines.append(press)
            lines.append("")

        if news:
            lines.append("--- News Page ---")
            lines.append(news)
            lines.append("")

        lines.append("")

    return "\n".join(lines)


def main() -> None:
    payload = load_payload()
    inputs = payload.get("inputs", {}) or {}
    params = payload.get("params", {}) or {}

    # ACSA inputs are keyed by upstream step_id:
    #   {"qualify_leads": {"qualified_leads": [...], ...}}
    def find_in_inputs(key: str, default=None):
        if key in inputs:
            return inputs[key]
        for step_output in inputs.values():
            if isinstance(step_output, dict) and key in step_output:
                return step_output[key]
        return default

    qualified_leads = find_in_inputs("qualified_leads", [])
    if isinstance(qualified_leads, str):
        try:
            qualified_leads = json.loads(qualified_leads)
        except json.JSONDecodeError:
            qualified_leads = []
    if not isinstance(qualified_leads, list):
        qualified_leads = []

    if not qualified_leads:
        json.dump(
            {
                "scraped_companies": [],
                "scrape_stats": {"total": 0, "succeeded": 0, "partial": 0, "failed": 0},
                "analysis_prompt": "No companies to analyze.",
            },
            sys.stdout,
        )
        return

    # Configuration
    api_key_env = params.get("firecrawl_api_key_env", "FIRECRAWL_API_KEY")
    api_key = os.environ.get(api_key_env, "").strip()
    delay_ms = int(params.get("delay_between_requests_ms", DEFAULT_DELAY_MS))
    scrape_subpages = bool(params.get("scrape_subpages", True))
    timeout_secs = int(params.get("timeout_secs", DEFAULT_TIMEOUT_SECS))

    scraped_companies: list[dict] = []
    stats = {"total": len(qualified_leads), "succeeded": 0, "partial": 0, "failed": 0}

    if not api_key:
        print(
            f"WARNING: {api_key_env} is not set. Skipping live website scraping. "
            "Pipeline will fall back to using YC company descriptions for analysis.",
            file=sys.stderr,
        )
        for company in qualified_leads:
            if not isinstance(company, dict):
                continue
            skipped_company = company.copy()
            skipped_company["website_content"] = ""
            skipped_company["subpage_content"] = {}
            skipped_company["scrape_status"] = "skipped"
            skipped_company["scrape_error"] = "Firecrawl API key not configured"
            scraped_companies.append(skipped_company)
        stats["failed"] = len(scraped_companies)
    else:
        for idx, company in enumerate(qualified_leads):
            if not isinstance(company, dict):
                continue

            # Rate limiting between companies
            if idx > 0:
                time.sleep(delay_ms / 1000.0)

            result = scrape_company(
                company.copy(),
                api_key,
                delay_ms,
                scrape_subpages,
                timeout_secs,
            )

            status = result.get("scrape_status", "failed")
            if status == "ok":
                stats["succeeded"] += 1
            elif status == "partial":
                stats["partial"] += 1
            else:
                stats["failed"] += 1

            scraped_companies.append(result)

    # Build analysis prompt from successfully scraped companies
    analysis_prompt = build_analysis_prompt(scraped_companies)

    json.dump(
        {
            "scraped_companies": scraped_companies,
            "scrape_stats": stats,
            "analysis_prompt": analysis_prompt,
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
