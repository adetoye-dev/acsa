#!/usr/bin/env python3

import json
import os
import sys


def _load_credential_source(input_credentials):
    if isinstance(input_credentials, dict):
        return input_credentials

    if isinstance(input_credentials, str):
        stripped = input_credentials.strip()
        if stripped:
            if stripped.startswith("{"):
                try:
                    parsed = json.loads(stripped)
                except json.JSONDecodeError as error:
                    raise ValueError("credentials JSON is invalid") from error
                if not isinstance(parsed, dict):
                    raise ValueError("credentials JSON must decode to an object")
                return parsed
            return stripped

    raw_json = os.getenv("GOOGLE_SHEETS_CREDENTIALS")
    credentials_path = os.getenv("GOOGLE_SHEETS_CREDENTIALS_PATH")

    if raw_json:
        try:
            parsed = json.loads(raw_json)
        except json.JSONDecodeError as error:
            raise RuntimeError(
                "invalid GOOGLE_SHEETS_CREDENTIALS JSON in raw_json"
            ) from error
        if not isinstance(parsed, dict):
            raise RuntimeError("GOOGLE_SHEETS_CREDENTIALS must decode to a JSON object/dict")
        return parsed

    if credentials_path:
        try:
            with open(credentials_path, "r", encoding="utf-8") as handle:
                parsed = json.load(handle)
        except FileNotFoundError as error:
            raise RuntimeError(
                "GOOGLE_SHEETS_CREDENTIALS_PATH file not found for credentials_path"
            ) from error
        except OSError as error:
            raise RuntimeError(
                "failed reading GOOGLE_SHEETS_CREDENTIALS_PATH file for credentials_path"
            ) from error
        except json.JSONDecodeError as error:
            raise RuntimeError(
                "invalid JSON in GOOGLE_SHEETS_CREDENTIALS_PATH file for credentials_path"
            ) from error
        if not isinstance(parsed, dict):
            raise RuntimeError(
                "GOOGLE_SHEETS_CREDENTIALS_PATH must contain a JSON object/dict"
            )
        return parsed

    raise RuntimeError(
        "missing Google credentials: provide inputs.credentials or set GOOGLE_SHEETS_CREDENTIALS / GOOGLE_SHEETS_CREDENTIALS_PATH"
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
    if sheet_name.startswith("'") and sheet_name.endswith("'") and len(sheet_name) >= 2:
        if sheet_name[1:-1] == "":
            raise ValueError("Invalid sheet name: empty after stripping quotes")
        return sheet_name

    normalized_name = sheet_name

    if normalized_name == "":
        raise ValueError("Invalid sheet name: empty")

    # Check if name contains non-alphanumeric characters or spaces.
    if any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_" for c in normalized_name):
        # Escape any single quotes by doubling them per Google Sheets convention
        escaped_name = normalized_name.replace("'", "''")
        return f"'{escaped_name}'"
    return normalized_name


def _safe_row_echo(row_value):
    try:
        return _normalize_row(row_value)
    except ValueError:
        return []


def _first_sheet_title(service, spreadsheet_id: str) -> str:
    metadata = (
        service.spreadsheets()
        .get(spreadsheetId=spreadsheet_id, fields="sheets.properties.title")
        .execute()
    )
    sheets = metadata.get("sheets", [])
    if not sheets:
        raise RuntimeError("spreadsheet has no sheets")
    title = sheets[0].get("properties", {}).get("title")
    if not isinstance(title, str) or not title.strip():
        raise RuntimeError("could not resolve first sheet title")
    return title


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
    credentials_input = inputs.get("credentials", params.get("credentials"))

    sheet_id = inputs.get("sheet_id")
    row_input = inputs.get("row")
    if not isinstance(sheet_id, str) or not sheet_id.strip():
        print("google sheets append validation failed: missing required input sheet_id", file=sys.stderr)
        print(
            json.dumps(
                {
                    "appended": False,
                    "sheet_id": "",
                    "row": _safe_row_echo(row_input),
                    "error": "missing required input: sheet_id",
                }
            )
        )
        sys.exit(1)

    try:
        row_values = _normalize_row(row_input)
    except ValueError as error:
        row_preview = f"type={type(row_input).__name__}" + (
            f" len={len(row_input)}" if hasattr(row_input, "__len__") else ""
        )
        print(
            f"google sheets append validation failed for sheet_id={sheet_id!r} row=[{row_preview}]: {error}",
            file=sys.stderr,
        )
        print(
            json.dumps(
                {
                    "appended": False,
                    "sheet_id": sheet_id,
                    "row": _safe_row_echo(row_input),
                    "error": str(error),
                }
            )
        )
        sys.exit(1)

    try:
        from google.oauth2 import credentials as oauth_credentials
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError:
        print(
            "google sheets append dependency error: missing google-api-client dependencies",
            file=sys.stderr,
        )
        print(
            json.dumps(
                {
                    "appended": False,
                    "sheet_id": sheet_id,
                    "row": row_values,
                    "error": "missing dependency: install google-api-python-client and google-auth",
                    "error_code": "missing_google_dependencies",
                }
            )
        )
        sys.exit(1)

    try:

        scopes = ["https://www.googleapis.com/auth/spreadsheets"]
        credential_source = _load_credential_source(credentials_input)
        if isinstance(credential_source, dict):
            credentials = service_account.Credentials.from_service_account_info(
                credential_source,
                scopes=scopes,
            )
        elif isinstance(credential_source, str):
            credentials = oauth_credentials.Credentials(
                token=credential_source,
                scopes=scopes,
            )
        else:
            raise RuntimeError("unsupported credentials format")

        service = build("sheets", "v4", credentials=credentials, cache_discovery=False)

        sheet_name = params.get("sheet_name")
        explicit_range = params.get("sheet_range")
        if explicit_range:
            target_range = explicit_range
        elif isinstance(sheet_name, str) and sheet_name.strip():
            target_range = f"{_quote_sheet_name(sheet_name.strip())}!A:ZZ"
        else:
            first_sheet = _first_sheet_title(service, sheet_id)
            target_range = f"{_quote_sheet_name(first_sheet)}!A:ZZ"

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
                    "row": row_values,
                    "error": str(error),
                }
            )
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
