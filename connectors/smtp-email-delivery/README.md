# SMTP Email Delivery

This connector sends the finished AI news brief over SMTP so the demo ends with a real daily-delivery outcome, not only a local file write.

## Required environment variables

- `ACSA_DEMO_EMAIL_TO`
- `ACSA_SMTP_HOST`
- `ACSA_SMTP_PORT`
- `ACSA_SMTP_USERNAME`
- `ACSA_SMTP_PASSWORD`
- `ACSA_SMTP_FROM`
- optional `ACSA_SMTP_TLS`
  - default `auto`
  - `ssl` is used automatically for port `465`
  - `starttls` is used automatically for other ports
  - override with `ssl`, `starttls`, or `false`
- optional `ACSA_SMTP_TIMEOUT_SECS` (defaults to `25`)

The workflow passes `ACSA_SMTP_PASSWORD` through `params.secrets_env`.

## Gmail notes

If you are using Gmail:

- `ACSA_SMTP_USERNAME` should be your full Gmail address
- `ACSA_SMTP_FROM` should usually be that same Gmail address
- `ACSA_DEMO_EMAIL_TO` should be a plain email address with no quotes or display name
- `ACSA_SMTP_PASSWORD` must be a Google App Password, not your normal account password
- use plain ASCII quotes when exporting env vars in the shell
- avoid smart quotes copied from notes apps, docs, or chat apps
