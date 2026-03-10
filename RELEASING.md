# Releasing Acsa

This document is the release playbook for maintainers.

## Release flow

1. Cut a release candidate such as `v0.1.0-rc.1`
2. Ask early adopters to validate install, upgrade, and self-hosting flows
3. Fix blocking issues
4. Tag the stable release
5. Publish release notes and follow-up announcements

## Pre-release checklist

- update `CHANGELOG.md`
- review `cargo audit` and `npm audit`
- verify `cargo test --workspace`
- verify `cargo build --release --locked -p acsa-core`
- verify `cd ui && npm run build`
- verify the Docker and self-hosting docs still match the release path
- update `packaging/homebrew/acsa.rb`
- update `packaging/scoop/acsa.json`

## Tagged release workflow

The release workflow lives at `.github/workflows/release.yml`.

It is responsible for:

- building binary artifacts
- building the UI standalone artifact
- generating checksums
- publishing the container image

## Release notes structure

Recommended sections:

- highlights
- fixes
- breaking changes
- upgrade notes
- security notes
- known issues

## Upgrade guidance

Every stable release should include:

- any workflow schema impact
- database compatibility notes
- connector runtime compatibility notes
- changes to required environment variables

## Community launch checklist

- publish release notes
- publish checksums
- update install instructions
- update roadmap if priorities changed
- announce on the selected community channels
- monitor issues and discussion threads after launch
