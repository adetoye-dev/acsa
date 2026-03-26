#!/usr/bin/env python3

import json
import os
import sys


def _load_service_account_info() -> dict:
    raw_json = os.getenv("GOOGLE_SHEETS_CREDENTIALS")
    credentials_path = os.getenv("GOOGLE_SHEETS_CREDENTIALS_PATH")

    if raw_json:
        return json.loads(raw_json)
    if credentials_path:
        with open(credentials_path, "r", encoding="utf-8") as handle:
            return json.load(handle)

    raise RuntimeError(
        "missing Google credentials: set GOOGLE_SHEETS_CREDENTIALS or GOOGLE_SHEETS_CREDENTIALS_PATH"
    )


def _normalize_row(row_value):
    if isinstance(row_value, list):
        return ["" if item is None else str(item) for item in row_value]
    if isinstance(row_value, dict):
        return [
            "" if row_value[key] is None else str(row_value[key])
            for key in row_value.keys()
        ]
    raise ValueError("row must be an array or object")


def _quote_sheet_name(sheet_name: str) -> str:
    """Quote sheet names containing special characters or spaces for Google Sheets A1 notation."""
    # Check if name contains non-alphanumeric characters or spaces
    if any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_" for c in sheet_name):
        # If already quoted, don't double-quote
        if sheet_name.startswith("'") and sheet_name.endswith("'"):
            return sheet_name
        # Escape any single quotes by doubling them per Google Sheets convention
        escaped_name = sheet_name.replace("'", "''")
        return f"'{escaped_name}'"
    return sheet_name


def main() -> None:
    raw_payload = sys.stdin.read()
    try:
        payload = json.loads(raw_payload)
    except json.JSONDecodeError as error:
        print(f"invalid JSON input: {error}", file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        print(f"unexpected error while parsing input payload: {error}", file=sys.stderr)
        sys.exit(1)

    inputs = payload.get("inputs", {})
    params = payload.get("params", {})

    sheet_id = inputs.get("sheet_id")
    row_input = inputs.get("row")
    if not isinstance(sheet_id, str) or not sheet_id.strip():
        print(
            json.dumps(
                {
                    "appended": False,
                    "sheet_id": "",
                    "row": row_input,
                    "error": "missing required input: sheet_id",
                }
            )
        )
        sys.exit(1)

    try:
        row_values = _normalize_row(row_input)
    except ValueError as error:
        print(
            json.dumps(
                {
                    "appended": False,
                    "sheet_id": sheet_id,
                    "row": row_input,
                    "error": str(error),
                }
            )
        )
        sys.exit(1)

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        credentials_info = _load_service_account_info()
        credentials = service_account.Credentials.from_service_account_info(
            credentials_info,
            scopes=["https://www.googleapis.com/auth/spreadsheets"],
        )
        service = build("sheets", "v4", credentials=credentials, cache_discovery=False)

        sheet_name = params.get("sheet_name") or "Sheet1"
        quoted_sheet_name = _quote_sheet_name(sheet_name)
        target_range = params.get("sheet_range") or f"{quoted_sheet_name}!A:Z"
        response = (
            service.spreadsheets()
            .values()
            .append(
                spreadsheetId=sheet_id,
                range=target_range,
                valueInputOption="RAW",
                insertDataOption="INSERT_ROWS",
                body={"values": [row_values]},
            )
            .execute()
        )
        if response.get("updates", {}).get("updatedRows", 0) < 1:
            raise RuntimeError("Google Sheets API did not append any row")

        print(
            json.dumps(
                {
                    "appended": True,
                    "sheet_id": sheet_id,
                    "row": row_values,
                }
            )
        )
    except Exception as error:
        print(f"google sheets append failed: {error}", file=sys.stderr)
        print(
            json.dumps(
                {
                    "appended": False,
                    "sheet_id": sheet_id,
                    "row": row_input,
                    "error": str(error),
                }
            )
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
