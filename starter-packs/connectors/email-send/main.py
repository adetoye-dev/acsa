#!/usr/bin/env python3

import ipaddress
from concurrent.futures import ThreadPoolExecutor, TimeoutError
import json
import re
import socket
import sys
import uuid


HOSTNAME_PATTERN = re.compile(
    r"^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$"
)
DNS_LOOKUP_TIMEOUT_SECONDS = 5


def _is_blocked_resolved_ip(ip_text: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_text)
    except ValueError:
        return True

    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _validate_smtp_host(smtp_host: str | None) -> str | None:
    if smtp_host is None:
        return None

    host = str(smtp_host).strip().lower()
    if not host:
        return None

    if host in {"localhost", "localhost.localdomain"}:
        raise ValueError("smtp_host must not use localhost")

    # Reject direct IP literals to avoid bypassing hostname-level controls.
    try:
        ipaddress.ip_address(host)
        raise ValueError("smtp_host must be a DNS hostname, not a raw IP address")
    except ValueError as error:
        if "must be a DNS hostname" in str(error):
            raise

    if not HOSTNAME_PATTERN.match(host):
        raise ValueError("smtp_host must be a valid public DNS hostname")

    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            lookup = executor.submit(socket.getaddrinfo, host, None, 0, socket.SOCK_STREAM)
            resolved = lookup.result(timeout=DNS_LOOKUP_TIMEOUT_SECONDS)
    except TimeoutError as error:
        raise ValueError(
            f"smtp_host could not be resolved: DNS lookup timed out after {DNS_LOOKUP_TIMEOUT_SECONDS}s"
        ) from error
    except OSError as error:
        raise ValueError(f"smtp_host could not be resolved: {error}") from error

    for entry in resolved:
        ip_text = entry[4][0]
        if _is_blocked_resolved_ip(ip_text):
            raise ValueError(
                "smtp_host resolves to a private/reserved address, which is not allowed"
            )

    return host


def _coerce_bool(value, *, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)

    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off", ""}:
        return False
    raise ValueError(f"invalid boolean value: {value!r}")


def _non_empty_input(value) -> bool:
    return value is not None and str(value).strip() != ""


def _sanitized_error_payload(
    error_code: str,
    correlation_id: str,
    validation_error: str | None = None,
) -> dict:
    payload = {
        "mock": True,
        "would_send": False,
        "sent": False,
        "error_code": error_code,
        "error_message": (
            f"Email delivery configuration failed ({error_code}). "
            f"Reference: {correlation_id}"
        ),
        "correlation_id": correlation_id,
    }

    if validation_error:
        payload["validation_error"] = validation_error

    return payload


def main() -> None:
    raw_payload = ""
    try:
        raw_payload = sys.stdin.read()
        payload = json.loads(raw_payload)
    except json.JSONDecodeError as error:
        snippet = "<redacted>"
        print(
            f"invalid JSON input: {error.msg} at line {error.lineno} column {error.colno}; input prefix={snippet}",
            file=sys.stderr,
        )
        sys.exit(1)
    except Exception as error:
        print(f"unexpected error while reading connector payload: {error}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(payload, dict):
        print("invalid connector payload: expected a top-level JSON object", file=sys.stderr)
        sys.exit(1)

    inputs = payload.get("inputs", {})
    params = payload.get("params", {})
    
    if not isinstance(inputs, dict):
        print("invalid connector payload: inputs must be a JSON object", file=sys.stderr)
        sys.exit(1)
    if not isinstance(params, dict):
        print("invalid connector payload: params must be a JSON object", file=sys.stderr)
        sys.exit(1)

    smtp_host = inputs.get("smtp_host") or params.get("smtp_host")
    try:
        smtp_host = _validate_smtp_host(smtp_host)
    except ValueError as error:
        correlation_id = uuid.uuid4().hex
        print(
            f"invalid SMTP configuration: invalid_smtp_host; reason={error}; correlation_id={correlation_id}",
            file=sys.stderr,
        )
        print(
            json.dumps(
                _sanitized_error_payload(
                    "invalid_smtp_host",
                    correlation_id,
                    validation_error=str(error),
                )
            )
        )
        sys.exit(1)

    try:
        smtp_secure_raw = inputs["smtp_secure"] if "smtp_secure" in inputs else params.get("smtp_secure")
        smtp_tls_raw = inputs["smtp_tls"] if "smtp_tls" in inputs else params.get("smtp_tls")

        smtp_secure = _coerce_bool(
            smtp_secure_raw,
            default=False,
        )
        smtp_tls = _coerce_bool(
            smtp_tls_raw,
            default=True,
        )
    except ValueError as error:
        correlation_id = uuid.uuid4().hex
        print(
            f"invalid SMTP configuration: invalid_smtp_tls_flags; reason={error}; correlation_id={correlation_id}",
            file=sys.stderr,
        )
        print(
            json.dumps(
                _sanitized_error_payload(
                    "invalid_smtp_tls_flags",
                    correlation_id,
                    validation_error=str(error),
                )
            )
        )
        sys.exit(1)

    if not smtp_host:
        correlation_id = uuid.uuid4().hex
        print(
            f"invalid SMTP configuration: missing_smtp_host; correlation_id={correlation_id}",
            file=sys.stderr,
        )
        print(
            json.dumps(
                _sanitized_error_payload(
                    "missing_smtp_host",
                    correlation_id,
                    validation_error="smtp_host is required in inputs.smtp_host or params.smtp_host",
                )
            )
        )
        sys.exit(1)

    if _non_empty_input(inputs.get("smtp_password") or params.get("smtp_password")) and _non_empty_input(
        inputs.get("api_key") or params.get("api_key")
    ):
        correlation_id = uuid.uuid4().hex
        print(
            f"invalid SMTP configuration: ambiguous_auth_config; correlation_id={correlation_id}",
            file=sys.stderr,
        )
        print(json.dumps(_sanitized_error_payload("ambiguous_auth_config", correlation_id)))
        sys.exit(1)

    if smtp_secure and smtp_tls:
        print(
            "smtp configuration notice: both smtp_secure and smtp_tls are true; smtp_secure takes precedence",
            file=sys.stderr,
        )
        smtp_tls = False

    smtp_mode = "implicit_tls" if smtp_secure else "starttls" if smtp_tls else "plain"
    if smtp_mode == "plain":
        print(
            "smtp configuration warning: unencrypted plain SMTP mode is enabled; set smtp_tls=true or smtp_secure=true for transport encryption",
            file=sys.stderr,
        )

    recipient = inputs.get("recipient") or params.get("recipient")
    if not _non_empty_input(recipient):
        correlation_id = uuid.uuid4().hex
        print(
            f"invalid SMTP configuration: missing_recipient; correlation_id={correlation_id}",
            file=sys.stderr,
        )
        print(
            json.dumps(
                _sanitized_error_payload(
                    "missing_recipient",
                    correlation_id,
                    validation_error="recipient is required in inputs.recipient or params.recipient",
                )
            )
        )
        sys.exit(1)

    # MOCK IMPLEMENTATION: this starter pack does not send real email yet.
    print(
        json.dumps(
            {
                "mock": True,
                "would_send": True,
                "sent": False,
                "recipient": recipient,
                "subject": inputs.get("subject") or params.get("subject") or "",
                "smtp_host": smtp_host,
                "smtp_mode": smtp_mode,
            }
        )
    )


if __name__ == "__main__":
    main()
