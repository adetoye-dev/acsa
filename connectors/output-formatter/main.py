#!/usr/bin/env python3

"""Output Formatter connector for ACSA.

Takes AI-generated analysis and build proposals, cleans and structures them
into rows ready for Google Sheets. Also generates an email summary.
"""

import json
import re
import sys
from datetime import datetime, timezone

SHEET_COLUMNS = [
    "run_date",
    "company_name",
    "website_url",
    "industry",
    "funding_raised",
    "batch",
    "team_size",
    "value_proposition",
    "target_market",
    "pain_points",
    "competitor_gaps",
    "proposed_tool_name",
    "problem_statement",
    "solution_description",
    "mvp_tech_stack",
    "mvp_scope",
    "pitch_email_draft",
    "estimated_build_time",
    "business_impact",
    "quality_score",
    "status",
]

MAX_CELL_LENGTH = 50000


def load_payload() -> dict:
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError as error:
        raise SystemExit(f"invalid connector payload: {error}")


def extract_json_from_llm_text(text: str) -> list | dict | None:
    """Extract JSON from LLM output that may contain markdown code blocks or preamble."""
    if not text or not isinstance(text, str):
        return None

    # Strip markdown code block wrappers
    code_block_match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if code_block_match:
        text = code_block_match.group(1).strip()

    # Try to parse as-is
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try to find JSON array
    array_match = re.search(r"\[.*\]", text, re.DOTALL)
    if array_match:
        try:
            return json.loads(array_match.group())
        except json.JSONDecodeError:
            pass

    # Try to find JSON object
    obj_match = re.search(r"\{.*\}", text, re.DOTALL)
    if obj_match:
        try:
            parsed = json.loads(obj_match.group())
            return [parsed] if isinstance(parsed, dict) else parsed
        except json.JSONDecodeError:
            pass

    return None


def clean_value(value: object) -> str:
    """Clean a value for Google Sheets cell insertion."""
    if value is None:
        return ""
    if isinstance(value, list):
        return "; ".join(str(item) for item in value if item)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    text = str(value).strip()
    # Collapse excessive whitespace
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{3,}", "  ", text)
    # Truncate to Google Sheets limit
    if len(text) > MAX_CELL_LENGTH:
        text = text[:MAX_CELL_LENGTH - 3] + "..."
    return text


def calculate_quality_score(row: dict) -> int:
    """Calculate a quality score (1-10) based on field completeness and depth."""
    important_fields = [
        "pain_points",
        "proposed_tool_name",
        "problem_statement",
        "solution_description",
        "mvp_scope",
        "pitch_email_draft",
        "business_impact",
    ]

    score = 0
    total_weight = 0

    for field in important_fields:
        value = row.get(field, "")
        total_weight += 1
        if value and len(str(value)) > 10:
            score += 1
            # Bonus for detailed content
            if len(str(value)) > 100:
                score += 0.3

    # Secondary fields contribute less
    secondary_fields = ["target_market", "competitor_gaps", "mvp_tech_stack"]
    for field in secondary_fields:
        value = row.get(field, "")
        if value and len(str(value)) > 5:
            score += 0.3

    # Normalize to 1-10 scale
    max_possible = len(important_fields) * 1.3 + len(secondary_fields) * 0.3
    normalized = (score / max_possible) * 10
    return max(1, min(10, round(normalized)))


def match_proposals_to_companies(
    scraped_companies: list[dict],
    pain_points_data: list,
    proposals_data: list,
) -> list[dict]:
    """Match AI pain points and build proposals to their corresponding companies."""
    # Build lookups by company name (case-insensitive)
    pain_lookup: dict[str, dict] = {}
    if pain_points_data:
        if isinstance(pain_points_data, dict):
            pain_points_data = [pain_points_data]
        for item in pain_points_data:
            if isinstance(item, dict):
                name = str(item.get("company_name", item.get("name", ""))).strip().lower()
                if name:
                    pain_lookup[name] = item

    proposal_lookup: dict[str, dict] = {}
    if proposals_data:
        if isinstance(proposals_data, dict):
            proposals_data = [proposals_data]
        for item in proposals_data:
            if isinstance(item, dict):
                name = str(item.get("company_name", item.get("name", ""))).strip().lower()
                if name:
                    proposal_lookup[name] = item

    rows: list[dict] = []
    run_date = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    for company in scraped_companies:
        if not isinstance(company, dict):
            continue

        company_name = str(company.get("name", "")).strip()
        company_name_lower = company_name.lower()

        # Find matching pain points (try exact first, then fuzzy)
        pain = pain_lookup.get(company_name_lower, {})
        if not pain:
            for pname, pdata in pain_lookup.items():
                if pname in company_name_lower or company_name_lower in pname:
                    pain = pdata
                    break

        # Find matching proposal (try exact first, then fuzzy)
        proposal = proposal_lookup.get(company_name_lower, {})
        if not proposal:
            for pname, pdata in proposal_lookup.items():
                if pname in company_name_lower or company_name_lower in pname:
                    proposal = pdata
                    break

        industry = company.get("industry", [])
        if isinstance(industry, list):
            industry = ", ".join(industry)

        # Merge fields from both LLM outputs
        pain_points = pain.get("pain_points", pain.get("product_gaps", []))
        competitor_gaps = pain.get("competitor_weaknesses", pain.get("competitor_gaps", []))

        # Merge AI extracted funding round and raised details
        funding_raised = pain.get("funding_raised", company.get("funding_raised", "Unknown"))
        if not funding_raised or funding_raised == "Unknown":
            funding_raised = company.get("funding_raised", "Unknown")
        funding_stage = pain.get("funding_stage", "Unknown")

        row = {
            "run_date": run_date,
            "company_name": company_name,
            "website_url": clean_value(company.get("url", "")),
            "industry": clean_value(industry),
            "funding_raised": clean_value(funding_raised),
            "funding_stage": clean_value(funding_stage),
            "batch": clean_value(company.get("batch", "")),
            "team_size": clean_value(company.get("team_size", "Unknown")),
            "value_proposition": clean_value(
                company.get("one_liner", "") or company.get("long_description", "")
            ),
            "target_market": clean_value(
                pain.get("target_market", pain.get("what_they_do", ""))
            ),
            "pain_points": clean_value(pain_points),
            "competitor_gaps": clean_value(competitor_gaps),
            "proposed_tool_name": clean_value(proposal.get("tool_name", "")),
            "problem_statement": clean_value(proposal.get("problem_statement", "")),
            "solution_description": clean_value(proposal.get("solution_description", "")),
            "mvp_tech_stack": clean_value(proposal.get("mvp_tech_stack", "")),
            "mvp_scope": clean_value(proposal.get("mvp_scope", "")),
            "pitch_email_draft": clean_value(proposal.get("pitch_email_draft", "")),
            "estimated_build_time": clean_value(proposal.get("estimated_build_time", "")),
            "business_impact": clean_value(proposal.get("business_impact", "")),
            "quality_score": "",
            "status": "new",
        }

        row["quality_score"] = str(calculate_quality_score(row))
        rows.append(row)

    return rows


def generate_email_summary(rows: list[dict], run_date: str, spreadsheet_url: str = "") -> tuple[str, str, str]:
    """Generate email subject, body (plain text), and body_html."""
    count = len(rows)
    subject = f"\U0001f3af Pipeline Run: {count} new opportunities found \u2014 {run_date}"

    # Plain text body
    body_lines = [
        f"Startup Opportunity Pipeline \u2014 {run_date}",
        f"{'=' * 50}",
        f"",
        f"{count} new companies analyzed and ready for review.",
        "",
    ]

    for idx, row in enumerate(rows, start=1):
        score = row.get("quality_score", "?")
        body_lines.append(f"{idx}. {row.get('company_name', 'Unknown')} (Score: {score}/10)")
        body_lines.append(f"   URL: {row.get('website_url', '')}")
        body_lines.append(f"   Industry: {row.get('industry', 'N/A')}")
        tool_name = row.get("proposed_tool_name", "")
        if tool_name:
            body_lines.append(f"   Proposed Tool: {tool_name}")
        body_lines.append("")

    if spreadsheet_url:
        body_lines.append(f"View Google Sheet: {spreadsheet_url}")
    else:
        body_lines.append("Open your Google Sheet to see full details and pitch drafts.")
    body = "\n".join(body_lines)

    # HTML body
    html_rows = []
    for row in rows:
        score = row.get("quality_score", "?")
        try:
            score_val = int(score) if score and str(score).isdigit() else 0
        except ValueError:
            score_val = 0
        score_color = "#22c55e" if score_val >= 7 else "#f59e0b" if score_val >= 4 else "#ef4444"
        html_rows.append(f"""
        <tr>
            <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;font-weight:500;color:#1f2937;">{row.get('company_name', '')}</td>
            <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;color:#4b5563;">{row.get('industry', '')}</td>
            <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;color:#4b5563;font-style:italic;">{row.get('proposed_tool_name', '')}</td>
            <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">
                <span style="background:{score_color};color:white;padding:4px 10px;border-radius:12px;font-weight:bold;font-size:12px;">{score}</span>
            </td>
            <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;color:#4b5563;">{row.get('batch', '')}</td>
        </tr>""")

    sheet_button_html = ""
    if spreadsheet_url:
        sheet_button_html = f"""
        <div style="margin: 28px 0; text-align: center;">
            <a href="{spreadsheet_url}" target="_blank" style="background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block; box-shadow: 0 4px 10px rgba(37, 99, 235, 0.2); transition: all 0.2s ease;">
                🎯 View Your Google Sheet
            </a>
        </div>
        """

    body_html = f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:700px;margin:0 auto;background-color:#f9fafb;padding:20px;border-radius:16px;">
        <div style="background:linear-gradient(135deg,#1e3a8a,#3b82f6);color:white;padding:32px;border-radius:12px 12px 0 0;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
            <h1 style="margin:0;font-size:24px;font-weight:700;letter-spacing:-0.025em;">🎯 Startup Opportunity Pipeline</h1>
            <p style="margin:8px 0 0;opacity:0.9;font-size:14px;">{run_date} &bull; {count} new opportunities analyzed</p>
        </div>
        <div style="background:white;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
                <thead>
                    <tr style="background:#f3f4f6;">
                        <th style="padding:12px 8px;text-align:left;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Company</th>
                        <th style="padding:12px 8px;text-align:left;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Industry</th>
                        <th style="padding:12px 8px;text-align:left;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Proposed Tool</th>
                        <th style="padding:12px 8px;text-align:center;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Score</th>
                        <th style="padding:12px 8px;text-align:left;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Batch</th>
                    </tr>
                </thead>
                <tbody>
                    {''.join(html_rows) if html_rows else '<tr><td colspan="5" style="text-align:center;padding:24px;color:#6b7280;">No new opportunities qualified in this run.</td></tr>'}
                </tbody>
            </table>
            {sheet_button_html}
            <p style="margin:20px 0 0;color:#6b7280;font-size:13px;text-align:center;line-height:1.5;">
                Open your Google Sheet for full details, personalized build proposals, tech stacks, and drafted cold pitch emails.
            </p>
        </div>
    </div>
    """

    return subject, body, body_html


def parse_funding_to_usd(funding_str: str) -> float:
    """Parse a funding string like '$2.5M', '$500,000', or '$1.2 Billion' to raw USD float."""
    if not funding_str or not isinstance(funding_str, str):
        return 0.0
    text = funding_str.strip().lower().replace(",", "")
    # Find all digits and possible decimal point
    match = re.search(r"([\d\.]+)", text)
    if not match:
        return 0.0
    try:
        val = float(match.group(1))
    except ValueError:
        return 0.0
    if "k" in text:
        val *= 1000
    elif "m" in text or "million" in text:
        val *= 1000000
    elif "b" in text or "billion" in text:
        val *= 1000000000
    return val


def main() -> None:
    payload = load_payload()
    inputs = payload.get("inputs", {}) or {}
    params = payload.get("params", {}) or {}

    min_funding_usd = float(params.get("min_funding_usd", 0.0))
    funding_round_whitelist = params.get("funding_round_whitelist", [])
    if isinstance(funding_round_whitelist, str):
        funding_round_whitelist = [funding_round_whitelist]
    max_rows_to_output = int(params.get("max_rows_to_output", 0))

    # ACSA inputs are keyed by upstream step_id:
    #   {"generate_build_proposals": {"content": "...", ...},
    #    "scrape_websites": {"scraped_companies": [...]}, ...}
    def find_in_inputs(key: str, default=None):
        if key in inputs:
            return inputs[key]
        for step_output in inputs.values():
            if isinstance(step_output, dict) and key in step_output:
                return step_output[key]
        return default

    # 1. Load and parse the LLM output from the analyze_pain_points step
    pain_points_step = inputs.get("analyze_pain_points", {})
    pain_points_content = ""
    if isinstance(pain_points_step, dict):
        pain_points_content = pain_points_step.get("content", pain_points_step.get("text", ""))

    if not pain_points_content:
        # Fallback search excluding proposals step
        for step_id, step_output in inputs.items():
            if step_id != "generate_build_proposals" and isinstance(step_output, dict) and "content" in step_output:
                pain_points_content = step_output["content"]
                break

    if isinstance(pain_points_content, dict):
        pain_points_content = pain_points_content.get("content", pain_points_content.get("text", json.dumps(pain_points_content)))

    pain_points_data = extract_json_from_llm_text(str(pain_points_content)) or []

    # 2. Load and parse the LLM output from the generate_build_proposals step
    proposals_step = inputs.get("generate_build_proposals", {})
    proposals_content = ""
    if isinstance(proposals_step, dict):
        proposals_content = proposals_step.get("content", proposals_step.get("text", ""))

    if not proposals_content:
        proposals_content = find_in_inputs("content", "")

    if isinstance(proposals_content, dict):
        proposals_content = proposals_content.get("content", proposals_content.get("text", json.dumps(proposals_content)))

    proposals_data = extract_json_from_llm_text(str(proposals_content)) or []

    # The scraped companies from the scrape step
    scraped_companies = find_in_inputs("scraped_companies", [])
    if isinstance(scraped_companies, str):
        try:
            scraped_companies = json.loads(scraped_companies)
        except json.JSONDecodeError:
            scraped_companies = []

    # Match and merge both pain points and proposals to companies
    rows = match_proposals_to_companies(scraped_companies, pain_points_data, proposals_data)

    # Filter rows based on funding criteria
    filtered_rows = []
    for r in rows:
        funding_str = r.get("funding_raised", "")
        funding_val = parse_funding_to_usd(funding_str)

        # Fallback: YC backed startups have a standard deal of at least $500k
        if funding_val == 0.0:
            batch = r.get("batch", "").strip()
            if batch and (batch.startswith("W") or batch.startswith("S")) and len(batch) >= 3 and batch[1:].isdigit():
                funding_val = 500000.0

        # Check minimum funding
        if min_funding_usd > 0 and funding_val < min_funding_usd:
            print(
                f"FILTER REJECTION: {r.get('company_name')} excluded. "
                f"Funding {funding_str!r} (parsed: {funding_val}) below minimum {min_funding_usd}",
                file=sys.stderr
            )
            continue

        # Check funding round whitelist
        funding_stage = r.get("funding_stage", "Unknown").lower()
        if funding_round_whitelist:
            whitelist_lower = [round_name.lower().strip() for round_name in funding_round_whitelist]
            if not any(wl in funding_stage for wl in whitelist_lower):
                print(
                    f"FILTER REJECTION: {r.get('company_name')} excluded. "
                    f"Funding stage {funding_stage!r} not in whitelist {funding_round_whitelist}",
                    file=sys.stderr
                )
                continue

        filtered_rows.append(r)

    if max_rows_to_output > 0:
        filtered_rows = filtered_rows[:max_rows_to_output]

    rows = filtered_rows

    # Get spreadsheet URL if available
    spreadsheet_url = find_in_inputs("spreadsheet_url", "")

    run_date = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    subject, body, body_html = generate_email_summary(rows, run_date, spreadsheet_url)

    json.dump(
        {
            "rows": rows,
            "email_subject": subject,
            "email_body": body,
            "email_body_html": body_html,
            "total_rows": len(rows),
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()

