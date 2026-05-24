#!/usr/bin/env python3
"""Google Sheets Writer connector — appends analyzed startup data rows to a Google Sheet."""

import json
import os
import sys

import gspread
from google.oauth2.service_account import Credentials

import base64
from pathlib import Path

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# Auto-discovery paths relative to this connector script's location.
_SCRIPT_DIR = Path(__file__).resolve().parent
_AUTO_DISCOVER_PATHS = [
    _SCRIPT_DIR / ".." / ".." / "credentials" / "google-sheets-sa.json",
    _SCRIPT_DIR / ".." / ".." / "credentials" / "service-account.json",
    _SCRIPT_DIR / ".." / ".." / "credentials" / "gsheets.json",
]


def _try_parse_credentials_json(raw: str) -> dict | None:
    """Try to parse a credentials string as base64-encoded JSON, then raw JSON."""
    try:
        decoded = base64.b64decode(raw, validate=True).decode("utf-8")
        return json.loads(decoded)
    except Exception:
        pass
    try:
        return json.loads(raw)
    except Exception:
        pass
    return None


def get_gspread_client() -> gspread.Client:
    """Authenticate and return a gspread client.

    Resolution order:
    1. GOOGLE_SHEETS_CREDENTIALS_JSON env var (base64-encoded or raw JSON)
    2. GOOGLE_SHEETS_CREDENTIALS_PATH env var (absolute file path)
    3. Auto-discover credentials file relative to connector location
    """
    creds_json = os.environ.get("GOOGLE_SHEETS_CREDENTIALS_JSON", "").strip()
    creds_path = os.environ.get("GOOGLE_SHEETS_CREDENTIALS_PATH", "").strip()

    # --- Method 1: Inline JSON (via env var) ---
    if creds_json:
        info = _try_parse_credentials_json(creds_json)
        if info:
            try:
                credentials = Credentials.from_service_account_info(info, scopes=SCOPES)
                return gspread.authorize(credentials)
            except Exception as exc:
                raise SystemExit(f"Google auth failed with inline credentials: {exc}")
        print(
            f"WARNING: GOOGLE_SHEETS_CREDENTIALS_JSON set but could not parse "
            f"(length={len(creds_json)}, starts_with={creds_json[:20]!r}...)",
            file=sys.stderr,
        )

    # --- Method 2: Explicit file path (via env var) ---
    if creds_path:
        resolved = Path(creds_path).expanduser().resolve()
        if resolved.is_file():
            try:
                credentials = Credentials.from_service_account_file(str(resolved), scopes=SCOPES)
                return gspread.authorize(credentials)
            except Exception as exc:
                raise SystemExit(f"Google auth failed with credentials file: {exc}")
        print(
            f"WARNING: GOOGLE_SHEETS_CREDENTIALS_PATH={creds_path!r} does not exist",
            file=sys.stderr,
        )

    # --- Method 3: Auto-discover from project structure ---
    for candidate in _AUTO_DISCOVER_PATHS:
        resolved = candidate.resolve()
        if resolved.is_file():
            try:
                credentials = Credentials.from_service_account_file(str(resolved), scopes=SCOPES)
                print(f"Using auto-discovered credentials: {resolved}", file=sys.stderr)
                return gspread.authorize(credentials)
            except Exception as exc:
                raise SystemExit(f"Google auth failed with {resolved}: {exc}")

    raise SystemExit(
        "Google Sheets credentials not found. Use one of:\n"
        "  1. Place your service-account JSON at credentials/google-sheets-sa.json\n"
        "  2. Set GOOGLE_SHEETS_CREDENTIALS_PATH to the absolute file path\n"
        "  3. Set GOOGLE_SHEETS_CREDENTIALS_JSON with base64-encoded JSON:\n"
        "     base64 -i your-key.json | tr -d '\\n'"
    )


# Canonical column order for the output sheet.
HEADER_COLUMNS = [
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


def open_or_create_spreadsheet(
    client: gspread.Client, spreadsheet_name: str
) -> gspread.Spreadsheet:
    """Open an existing spreadsheet by name, or create a new one."""
    try:
        return client.open(spreadsheet_name)
    except gspread.SpreadsheetNotFound:
        try:
            return client.create(spreadsheet_name)
        except gspread.exceptions.APIError as exc:
            if "quota" in str(exc).lower():
                raise SystemExit(
                    f"\n======================================================================\n"
                    f"GOOGLE SHEET NOT FOUND & DRIVE QUOTA EXCEEDED:\n"
                    f"The spreadsheet '{spreadsheet_name}' does not exist, and the Google Service Account "
                    f"is not allowed to create files directly due to Drive storage limits.\n\n"
                    f"FIX:\n"
                    f"1. Open Google Sheets (https://sheets.google.com)\n"
                    f"2. Create a new sheet named exactly: {spreadsheet_name}\n"
                    f"3. Share it with your Service Account email as an Editor:\n"
                    f"   google-sheets-service-account@acsa-workflow-studio.iam.gserviceaccount.com\n"
                    f"======================================================================\n"
                )
            raise exc
    except gspread.exceptions.APIError as exc:
        raise SystemExit(
            f"Google Sheets API error while opening '{spreadsheet_name}': {exc}"
        )


def get_or_create_worksheet(
    spreadsheet: gspread.Spreadsheet, worksheet_name: str
) -> gspread.Worksheet:
    """Return the named worksheet, creating it if it doesn't exist."""
    try:
        return spreadsheet.worksheet(worksheet_name)
    except gspread.WorksheetNotFound:
        return spreadsheet.add_worksheet(
            title=worksheet_name, rows=1000, cols=len(HEADER_COLUMNS)
        )


def ensure_header_row(worksheet: gspread.Worksheet) -> None:
    """Write the header row if the worksheet is empty or lacks the correct header."""
    existing = worksheet.get_all_values()
    has_header = False
    if existing:
        first_row = existing[0]
        if len(first_row) > 0 and first_row[0] == "run_date":
            has_header = True

    if not has_header:
        if not existing:
            worksheet.append_row(HEADER_COLUMNS, value_input_option="USER_ENTERED")
        else:
            # Insert at the very top
            worksheet.insert_row(HEADER_COLUMNS, index=1, value_input_option="USER_ENTERED")


def dict_to_row(row_dict: dict) -> list[str]:
    """Convert a row dictionary to a list aligned to HEADER_COLUMNS."""
    return [str(row_dict.get(col, "")) for col in HEADER_COLUMNS]


def main() -> None:
    payload = json.load(sys.stdin)
    params = payload.get("params", {}) or {}
    inputs = payload.get("inputs", {}) or {}

    spreadsheet_name = params.get("spreadsheet_name", "Startup Opportunity Pipeline")
    worksheet_name = params.get("worksheet_name", "Leads")

    def find_in_inputs(key: str, default=None):
        if key in inputs:
            return inputs[key]
        for step_output in inputs.values():
            if isinstance(step_output, dict) and key in step_output:
                return step_output[key]
        return default

    rows = find_in_inputs("rows", [])

    if not isinstance(rows, list):
        raise SystemExit("inputs.rows must be a list of dictionaries.")
    if not rows:
        # Nothing to write — return zeros.
        json.dump(
            {"rows_written": 0, "spreadsheet_url": "", "worksheet_name": worksheet_name},
            sys.stdout,
        )
        return

    client = get_gspread_client()
    spreadsheet = open_or_create_spreadsheet(client, spreadsheet_name)
    worksheet = get_or_create_worksheet(spreadsheet, worksheet_name)

    ensure_header_row(worksheet)

    # Build all row lists and batch-append them.
    row_values = [dict_to_row(r) for r in rows if isinstance(r, dict)]
    if row_values:
        worksheet.append_rows(row_values, value_input_option="USER_ENTERED")

    json.dump(
        {
            "rows_written": len(row_values),
            "spreadsheet_url": f"{spreadsheet.url}#gid={worksheet.id}",
            "worksheet_name": worksheet_name,
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
