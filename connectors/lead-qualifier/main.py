#!/usr/bin/env python3

"""Lead Qualifier connector for ACSA.

Filters discovered companies against qualification criteria and deduplicates
against already-processed leads from Google Sheets.
"""

import json
import sys
import urllib.parse


def load_payload() -> dict:
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError as error:
        raise SystemExit(f"invalid connector payload: {error}")


def extract_domain(url: str) -> str:
    """Extract and normalize the domain from a URL for dedup comparison."""
    url = url.strip()
    if not url:
        return ""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    parsed = urllib.parse.urlparse(url)
    domain = parsed.netloc.lower().rstrip(".")
    if domain.startswith("www."):
        domain = domain[4:]
    return domain


def qualify_company(
    company: dict,
    exclude_domains: set[str],
    required_hiring: bool,
    batch_whitelist: list[str],
    industry_blacklist: list[str],
) -> tuple[bool, str]:
    """Check if a company passes all qualification filters.

    Returns (qualified: bool, rejection_reason: str).
    """
    # Deduplication check
    domain = extract_domain(company.get("url", ""))
    if domain and domain in exclude_domains:
        return False, "already processed"

    # Name-based dedup if no URL
    name = company.get("name", "").strip()
    if not name:
        return False, "missing company name"

    # Hiring filter
    if required_hiring and not company.get("is_hiring", False):
        return False, "not currently hiring"

    # Batch whitelist filter
    if batch_whitelist:
        company_batch = company.get("batch", "").strip()
        if company_batch and company_batch not in batch_whitelist:
            return False, f"batch {company_batch!r} not in whitelist"

    # Industry blacklist filter
    if industry_blacklist:
        company_industries = company.get("industry", [])
        if isinstance(company_industries, str):
            company_industries = [company_industries]
        blacklist_lower = {ind.lower().strip() for ind in industry_blacklist}
        for industry in company_industries:
            if industry.lower().strip() in blacklist_lower:
                return False, f"industry blacklisted: {industry}"

    # URL is required for downstream scraping
    if not company.get("url", "").strip():
        return False, "missing website URL"

    return True, ""


def main() -> None:
    payload = load_payload()
    inputs = payload.get("inputs", {}) or {}
    params = payload.get("params", {}) or {}

    # ACSA inputs are keyed by upstream step_id:
    #   {"discover_startups": {"companies": [...]}, "read_existing_leads": {"existing_entries": [...]}}
    # Flatten: try direct key first, then look inside nested step outputs.
    def find_in_inputs(key: str, default=None):
        """Search for a key in inputs — try top-level, then inside each step output."""
        if key in inputs:
            return inputs[key]
        for step_output in inputs.values():
            if isinstance(step_output, dict) and key in step_output:
                return step_output[key]
        return default

    companies = find_in_inputs("companies", [])
    if isinstance(companies, str):
        try:
            companies = json.loads(companies)
        except json.JSONDecodeError:
            companies = []
    if not isinstance(companies, list):
        companies = []

    # Get existing entries for dedup (from gsheets-reader)
    exclude_entries = find_in_inputs("existing_entries", [])
    if isinstance(exclude_entries, str):
        try:
            exclude_entries = json.loads(exclude_entries)
        except json.JSONDecodeError:
            exclude_entries = []
    if not isinstance(exclude_entries, list):
        exclude_entries = []

    # Normalize exclude domains
    exclude_domains: set[str] = set()
    for entry in exclude_entries:
        domain = extract_domain(str(entry))
        if domain:
            exclude_domains.add(domain)

    # Get filter params
    max_leads = int(params.get("max_leads", 10))
    required_hiring = bool(params.get("required_hiring", True))
    batch_whitelist = params.get("batch_whitelist", [])
    if isinstance(batch_whitelist, str):
        batch_whitelist = [batch_whitelist]
    industry_blacklist = params.get("industry_blacklist", [])
    if isinstance(industry_blacklist, str):
        industry_blacklist = [industry_blacklist]

    qualified: list[dict] = []
    rejections: list[dict] = []

    for company in companies:
        if not isinstance(company, dict):
            continue

        passed, reason = qualify_company(
            company,
            exclude_domains,
            required_hiring,
            batch_whitelist,
            industry_blacklist,
        )

        if passed:
            if len(qualified) < max_leads:
                qualified.append(company)
            else:
                rejections.append({
                    "company": company.get("name", "Unknown"),
                    "reason": f"max leads cap reached ({max_leads})",
                })
        else:
            rejections.append({
                "company": company.get("name", "Unknown"),
                "reason": reason,
            })

    json.dump(
        {
            "qualified_leads": qualified,
            "filtered_count": len(qualified),
            "rejection_reasons": rejections,
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
