#!/usr/bin/env python3

"""Startup Discovery connector for ACSA.

Discovers funded startups from the YC directory via the public yc-oss API.
Outputs a standardized list of company objects for downstream processing.
"""

import json
import sys
import urllib.error
import urllib.parse
import urllib.request

# YC OSS public API — no API keys needed, highly reliable
YC_OSS_API = "https://yc-oss.github.io/api/batches/{batch}.json"
DEFAULT_BATCHES = ["W24", "S24", "W25", "S25", "W26"]
DEFAULT_MAX_RESULTS = 50
USER_AGENT = "Acsa Startup Pipeline/1.0 (+https://github.com/achsah-systems/acsa)"


def load_payload() -> dict:
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError as error:
        raise SystemExit(f"invalid connector payload: {error}")


def normalize_url(url: str) -> str:
    """Normalize a company URL for consistency."""
    url = url.strip()
    if not url:
        return ""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    parsed = urllib.parse.urlparse(url)
    return urllib.parse.urlunparse((
        parsed.scheme,
        parsed.netloc.lower().rstrip("."),
        parsed.path.rstrip("/") or "/",
        "",
        "",
        "",
    ))


def extract_domain(url: str) -> str:
    """Extract the base domain from a URL for deduplication."""
    parsed = urllib.parse.urlparse(normalize_url(url))
    domain = parsed.netloc.lower()
    if domain.startswith("www."):
        domain = domain[4:]
    return domain


def parse_yc_company(item: dict) -> dict:
    """Convert a yc-oss API company object into a standardized company object."""
    name = str(item.get("name", "")).strip()
    website = normalize_url(str(item.get("website", "")).strip())
    slug = str(item.get("slug", "")).strip()

    industries = item.get("industries", [])
    if isinstance(industries, str):
        industries = [industries]
    elif not isinstance(industries, list):
        industries = []

    # Tags can supplement industries
    tags = item.get("tags", [])
    if isinstance(tags, list):
        for tag in tags:
            if tag and tag not in industries:
                industries.append(tag)

    team_size = item.get("team_size", 0)
    if isinstance(team_size, str):
        try:
            team_size = int(team_size)
        except ValueError:
            team_size = 0

    return {
        "name": name,
        "url": website,
        "one_liner": str(item.get("one_liner", "")).strip(),
        "long_description": str(item.get("long_description", "")).strip(),
        "industry": industries,
        "batch": str(item.get("batch", "")).strip(),
        "team_size": team_size,
        "location": str(item.get("all_locations", "")).strip(),
        "is_hiring": bool(item.get("isHiring", False)),
        "source": "yc_directory",
        "yc_url": f"https://www.ycombinator.com/companies/{slug}" if slug else "",
        "logo_url": str(item.get("small_logo_thumb_url", "")).strip(),
        "status": str(item.get("status", "")).strip(),
        "stage": str(item.get("stage", "")).strip(),
    }


def fetch_yc_batch(
    batch: str,
    hiring_only: bool,
    timeout_secs: int = 15,
) -> tuple[list[dict], dict]:
    """Fetch companies from the yc-oss API for a single batch."""
    batch_lower = batch.lower()
    url = YC_OSS_API.format(batch=batch_lower)

    source_stat = {
        "name": f"YC Batch {batch}",
        "type": "yc_oss_api",
        "status": "ok",
        "count": 0,
        "error": None,
    }

    try:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=timeout_secs) as response:
            data = json.loads(response.read().decode("utf-8", errors="replace"))

        if not isinstance(data, list):
            source_stat["status"] = "failed"
            source_stat["error"] = f"unexpected response format for batch {batch}"
            return [], source_stat

        companies = []
        for item in data:
            if not isinstance(item, dict):
                continue

            # Skip non-hiring if filter is on
            if hiring_only and not item.get("isHiring", False):
                continue

            # Skip inactive companies
            status = str(item.get("status", "")).strip()
            if status and status.lower() in ("dead", "acquired", "inactive"):
                continue

            company = parse_yc_company(item)
            if company["name"] and company["url"]:
                companies.append(company)

        source_stat["count"] = len(companies)
        return companies, source_stat

    except urllib.error.HTTPError as error:
        source_stat["status"] = "failed"
        source_stat["error"] = f"HTTP {error.code} for batch {batch}: {error.reason}"
        return [], source_stat
    except urllib.error.URLError as error:
        source_stat["status"] = "failed"
        source_stat["error"] = f"URL error for batch {batch}: {error.reason}"
        return [], source_stat
    except Exception as error:
        source_stat["status"] = "failed"
        source_stat["error"] = f"unexpected error for batch {batch}: {error}"
        return [], source_stat


def discover_yc(
    batches: list[str],
    hiring_only: bool,
    max_results: int,
    timeout_secs: int = 15,
) -> tuple[list[dict], list[dict]]:
    """Discover YC companies across multiple batches."""
    all_companies: list[dict] = []
    all_stats: list[dict] = []

    for batch in batches:
        companies, stat = fetch_yc_batch(batch, hiring_only, timeout_secs)
        all_companies.extend(companies)
        all_stats.append(stat)

    # Deduplicate by domain
    seen_domains: set[str] = set()
    unique_companies: list[dict] = []
    for company in all_companies:
        domain = extract_domain(company.get("url", ""))
        dedupe_key = domain or company.get("name", "").lower().strip()
        if dedupe_key and dedupe_key not in seen_domains:
            seen_domains.add(dedupe_key)
            unique_companies.append(company)

    return unique_companies[:max_results], all_stats


def main() -> None:
    payload = load_payload()
    params = payload.get("params", {}) or {}

    sources = params.get("sources", ["yc_directory"])
    if isinstance(sources, str):
        sources = [sources]
    elif not isinstance(sources, (list, tuple)):
        sources = ["yc_directory"]

    try:
        max_results = int(params.get("max_results", DEFAULT_MAX_RESULTS))
    except (ValueError, TypeError):
        max_results = DEFAULT_MAX_RESULTS

    try:
        timeout_secs = int(params.get("timeout_secs", 15))
    except (ValueError, TypeError):
        timeout_secs = 15

    filters = params.get("filters", {}) or {}
    hiring_only = bool(filters.get("hiring", True))
    batches = filters.get("batches", DEFAULT_BATCHES)
    if isinstance(batches, str):
        batches = [batches]

    all_companies: list[dict] = []
    all_stats: list[dict] = []

    for source in sources:
        if source == "yc_directory":
            companies, stats = discover_yc(batches, hiring_only, max_results, timeout_secs)
            all_companies.extend(companies)
            all_stats.extend(stats)
        else:
            all_stats.append({
                "name": source,
                "type": "unknown",
                "status": "skipped",
                "count": 0,
                "error": f"unknown source: {source}",
            })

    # Final dedup
    seen_domains: set[str] = set()
    unique_companies: list[dict] = []
    for company in all_companies:
        domain = extract_domain(company.get("url", ""))
        dedupe_key = domain or company.get("name", "").lower().strip()
        if dedupe_key and dedupe_key not in seen_domains:
            seen_domains.add(dedupe_key)
            unique_companies.append(company)

    result = unique_companies[:max_results]

    json.dump(
        {
            "companies": result,
            "source_stats": all_stats,
            "total_discovered": len(result),
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
