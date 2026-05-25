#!/usr/bin/env python3
"""Google Sheets Reader connector — reads existing entries from a column to prevent re-processing."""

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
# The connector lives at  <project>/connectors/gsheets-reader/main.py
# so ../../credentials/  points to  <project>/credentials/
_SCRIPT_DIR = Path(__file__).resolve().parent
_AUTO_DISCOVER_PATHS = [
    _SCRIPT_DIR / ".." / ".." / "credentials" / "google-sheets-sa.json",
    _SCRIPT_DIR / ".." / ".." / "credentials" / "service-account.json",
    _SCRIPT_DIR / ".." / ".." / "credentials" / "gsheets.json",
]


def _try_parse_credentials_json(raw: str) -> dict | None:
    """Try to parse a credentials string as base64-encoded JSON, then raw JSON."""
    # Try base64 first
    try:
        decoded = base64.b64decode(raw, validate=True).decode("utf-8")
        return json.loads(decoded)
    except Exception:
        pass
    # Try raw JSON
    try:
        return json.loads(raw)
    except Exception:
        pass
    return None


def get_gspread_client() -> tuple[gspread.Client, str]:
    """Authenticate and return a gspread client and the service account email.

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
                return gspread.authorize(credentials), credentials.service_account_email
            except Exception as exc:
                raise SystemExit(f"Google auth failed with inline credentials: {exc}")
        # Could not parse — print debug info and continue to other methods
        print(
            f"WARNING: GOOGLE_SHEETS_CREDENTIALS_JSON set but could not parse (length={len(creds_json)})",
            file=sys.stderr,
        )

    # --- Method 2: Explicit file path (via env var) ---
    if creds_path:
        resolved = Path(creds_path).expanduser().resolve()
        if resolved.is_file():
            try:
                credentials = Credentials.from_service_account_file(str(resolved), scopes=SCOPES)
                return gspread.authorize(credentials), credentials.service_account_email
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
                return gspread.authorize(credentials), credentials.service_account_email
            except Exception as exc:
                raise SystemExit(f"Google auth failed with {resolved}: {exc}")

    raise SystemExit(
        "Google Sheets credentials not found. Use one of:\n"
        "  1. Place your service-account JSON at credentials/google-sheets-sa.json\n"
        "  2. Set GOOGLE_SHEETS_CREDENTIALS_PATH to the absolute file path\n"
        "  3. Set GOOGLE_SHEETS_CREDENTIALS_JSON with base64-encoded JSON:\n"
        "     base64 -i your-key.json | tr -d '\\n'"
    )


def read_column_values(
    client: gspread.Client,
    spreadsheet_name: str,
    worksheet_name: str,
    column_name: str,
) -> list[str]:
    """Return all non-empty values under *column_name* in the given worksheet."""
    try:
        spreadsheet = client.open(spreadsheet_name)
    except gspread.SpreadsheetNotFound:
        # Spreadsheet doesn't exist yet — nothing to deduplicate against.
        return []
    except gspread.exceptions.APIError as exc:
        raise SystemExit(
            f"Google Sheets API error while opening '{spreadsheet_name}': {exc}"
        )

    try:
        worksheet = spreadsheet.worksheet(worksheet_name)
    except gspread.WorksheetNotFound:
        # Worksheet tab doesn't exist — treat as empty.
        return []
    except gspread.exceptions.APIError as exc:
        raise SystemExit(
            f"Google Sheets API error while opening worksheet '{worksheet_name}': {exc}"
        )

    all_rows = worksheet.get_all_values()
    if not all_rows:
        return []

    headers = [str(h).strip() for h in all_rows[0]]
    if column_name not in headers:
        return []

    col_idx = headers.index(column_name)

    return [
        str(row[col_idx]).strip()
        for row in all_rows[1:]
        if len(row) > col_idx and str(row[col_idx]).strip()
    ]


def main() -> None:
    payload = json.load(sys.stdin)
    params = payload.get("params", {}) or {}

    spreadsheet_name = params.get("spreadsheet_name", "")
    worksheet_name = params.get("worksheet_name", "")
    column_name = params.get("column_name", "website_url")

    if not spreadsheet_name:
        raise SystemExit("Missing required param 'spreadsheet_name'.")
    if not worksheet_name:
        raise SystemExit("Missing required param 'worksheet_name'.")

    client, service_account_email = get_gspread_client()

    # Attempt to open (or create) the spreadsheet to get the URL
    spreadsheet_url = ""
    try:
        spreadsheet = client.open(spreadsheet_name)
        # Get or create the worksheet tab to read from, and get its gid
        try:
            worksheet = spreadsheet.worksheet(worksheet_name)
        except gspread.WorksheetNotFound:
            worksheet = spreadsheet.add_worksheet(title=worksheet_name, rows=1000, cols=25)
        spreadsheet_url = f"{spreadsheet.url}#gid={worksheet.id}"
    except gspread.SpreadsheetNotFound:
        try:
            spreadsheet = client.create(spreadsheet_name)
            worksheet = spreadsheet.add_worksheet(title=worksheet_name, rows=1000, cols=25)
            spreadsheet_url = f"{spreadsheet.url}#gid={worksheet.id}"
        except gspread.exceptions.APIError as exc:
            if "quota" in str(exc).lower():
                print(
                    f"\nWARNING: Spreadsheet '{spreadsheet_name}' does not exist, and the Google Service Account "
                    f"cannot create it (Drive storage quota exceeded).\n"
                    f"Please create a spreadsheet named '{spreadsheet_name}' in your Google Drive and share it with:\n"
                    f"   {service_account_email} as an Editor.\n",
                    file=sys.stderr
                )
            else:
                print(f"WARNING: Could not create spreadsheet '{spreadsheet_name}': {exc}", file=sys.stderr)
        except Exception as exc:
            print(f"WARNING: Could not create spreadsheet '{spreadsheet_name}': {exc}", file=sys.stderr)
    except Exception as exc:
        print(f"WARNING: Could not open spreadsheet '{spreadsheet_name}': {exc}", file=sys.stderr)

    entries = read_column_values(client, spreadsheet_name, worksheet_name, column_name)

    json.dump(
        {
            "existing_entries": entries,
            "total_existing": len(entries),
            "spreadsheet_url": spreadsheet_url,
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
