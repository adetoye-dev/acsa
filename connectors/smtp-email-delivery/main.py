#!/usr/bin/env python3

import json
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage
from email.utils import parseaddr


def lookup_path(value, path):
    current = value
    for segment in path.split("."):
        if not segment:
            continue
        if not isinstance(current, dict) or segment not in current:
            raise KeyError(path)
        current = current[segment]
    return current


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"required environment variable {name} is not set")
    return value


def resolve_input(inputs: dict, params: dict, direct_key: str, path_key: str) -> str:
    if direct_key in inputs and isinstance(inputs[direct_key], str):
        return inputs[direct_key]
    if path_key in params:
        value = lookup_path(inputs, str(params[path_key]))
        if value is None:
            return ""
        return str(value)
    raise SystemExit(f"missing {direct_key}; provide it directly or via {path_key}")


def require_ascii(name: str, value: str) -> str:
    try:
        value.encode("ascii")
    except UnicodeEncodeError as error:
        raise SystemExit(
            f"{name} contains a non-ASCII character at position {error.start}; "
            "check for smart quotes or other copied punctuation in your environment variable"
        )
    return value


def require_email(name: str, value: str) -> str:
    value = require_ascii(name, value.strip())
    _, parsed = parseaddr(value)
    if not parsed or "@" not in parsed:
        raise SystemExit(
            f"{name} is not a valid email address; got {value!r}"
        )
    if parsed != value:
        raise SystemExit(
            f"{name} should be a plain email address without display names or extra punctuation; got {value!r}"
        )
    return value


def parse_int_env(name: str, value: str) -> int:
    try:
        return int(value)
    except ValueError as error:
        raise SystemExit(f"{name} must be an integer; got {value!r}") from error


def format_smtp_error(
    error: Exception,
    *,
    stage: str,
    host: str,
    port: int,
    resolved_tls_mode: str,
    timeout_secs: int,
) -> str:
    prefix = (
        f"smtp_email_delivery failed during {stage} to {host}:{port} "
        f"(tls={resolved_tls_mode}, timeout={timeout_secs}s): "
    )

    if isinstance(error, smtplib.SMTPAuthenticationError):
        details = str(error)
        details_lower = details.lower()
        if "gmail.com" in host and (
            "application-specific password required" in details_lower
            or "invalidsecondfactor" in details_lower
        ):
            return (
                prefix
                + "Gmail rejected the login because this account needs a Google App Password. "
                + "Enable 2-Step Verification, create an App Password in your Google account, "
                + "and set ACSA_SMTP_PASSWORD to that App Password instead of your normal Gmail password."
            )
        return prefix + details

    return prefix + str(error)


def main() -> None:
    payload = json.load(sys.stdin)
    inputs = payload.get("inputs", {}) or {}
    params = payload.get("params", {}) or {}
    secrets = payload.get("secrets", {}) or {}

    host = required_env("ACSA_SMTP_HOST")
    port = parse_int_env("ACSA_SMTP_PORT", required_env("ACSA_SMTP_PORT"))
    username = require_email("ACSA_SMTP_USERNAME", required_env("ACSA_SMTP_USERNAME"))
    sender = require_email("ACSA_SMTP_FROM", required_env("ACSA_SMTP_FROM"))
    recipient = require_email("ACSA_DEMO_EMAIL_TO", required_env("ACSA_DEMO_EMAIL_TO"))
    timeout_secs = parse_int_env(
        "ACSA_SMTP_TIMEOUT_SECS",
        os.environ.get("ACSA_SMTP_TIMEOUT_SECS", "25"),
    )
    password = secrets.get("password")
    if not password:
        raise SystemExit("smtp_email_delivery requires secrets.password from params.secrets_env")
    password = require_ascii("ACSA_SMTP_PASSWORD", str(password))

    tls_mode = os.environ.get("ACSA_SMTP_TLS", "auto").strip().lower()
    if tls_mode == "auto":
        use_ssl = port == 465
        use_starttls = not use_ssl
        resolved_tls_mode = "ssl" if use_ssl else "starttls"
    elif tls_mode in {"ssl", "smtps"}:
        use_ssl = True
        use_starttls = False
        resolved_tls_mode = "ssl"
    elif tls_mode in {"1", "true", "yes", "starttls"}:
        use_ssl = False
        use_starttls = True
        resolved_tls_mode = "starttls"
    elif tls_mode in {"0", "false", "no", "off"}:
        use_ssl = False
        use_starttls = False
        resolved_tls_mode = "plain"
    else:
        raise SystemExit(
            "invalid ACSA_SMTP_TLS value; expected auto, ssl, starttls, or false"
        )

    subject = resolve_input(inputs, params, "subject", "subject_path")
    body = resolve_input(inputs, params, "body", "body_path")
    body_html = ""
    if "body_html" in inputs and isinstance(inputs["body_html"], str):
        body_html = inputs["body_html"]
    elif "body_html_path" in params:
        try:
            body_html = str(lookup_path(inputs, str(params["body_html_path"])))
        except KeyError:
            body_html = ""

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = sender
    message["To"] = recipient
    message.set_content(body)
    if body_html:
        message.add_alternative(body_html, subtype="html")

    stage = "connect"
    try:
        if use_ssl:
            client = smtplib.SMTP_SSL(
                host,
                port,
                timeout=timeout_secs,
                context=ssl.create_default_context(),
            )
        else:
            client = smtplib.SMTP(host, port, timeout=timeout_secs)

        with client:
            stage = "ehlo"
            client.ehlo()
            if use_starttls:
                stage = "starttls"
                client.starttls(context=ssl.create_default_context())
                client.ehlo()
            stage = "login"
            client.login(username, password)
            stage = "send_message"
            client.send_message(message)
    except Exception as error:
        raise SystemExit(
            format_smtp_error(
                error,
                stage=stage,
                host=host,
                port=port,
                resolved_tls_mode=resolved_tls_mode,
                timeout_secs=timeout_secs,
            )
        )

    json.dump(
        {
            "message_id": message.get("Message-ID", ""),
            "recipient": recipient,
            "sent": True,
            "subject": subject,
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
