# Phase 9: Community Release and Documentation

This phase prepares Acsa for public consumption.  A successful open‑source
release requires more than working code; it needs documentation, a welcoming
community, and clear contribution guidelines.

## 1. Documentation

1. **User guide.**  Write a comprehensive guide covering installation,
   configuration, workflow authoring, connector creation, and troubleshooting.
   Include step‑by‑step tutorials for common use cases (e.g., sending daily
   emails, automating a support queue, building an AI chat assistant).

2. **API reference.**  Document the REST endpoints exposed by the engine
   (`/api/workflows`, `/api/runs`, etc.), the expected request/response
   formats, and error codes.  Provide examples using `curl` and `axios`.

3. **Connector development guide.**  Expand on Phase 5 by documenting the
   manifest schema, connector patterns, and security considerations.  Include
   examples of both subprocess and WASM connectors.

4. **UI manual.**  Describe how to use the visual builder.  Explain
   drag‑and‑drop, parameter editing, saving, running workflows, and viewing
   run history.

5. **Architecture documentation.**  Add diagrams showing the high‑level
   architecture: engine core, node registry, connectors, UI, and database.
   Explain how data flows through the system and how components interact.

## 2. Contribution Guidelines

1. **`CONTRIBUTING.md`.**  Create a contributing guide that explains how to
   set up the development environment, run tests, and submit pull requests.
   Require that contributors sign off their commits (DCO) and agree to the
   project license.

2. **Code of Conduct.**  Adopt a Code of Conduct (e.g., the Contributor
   Covenant) and place it in `CODE_OF_CONDUCT.md`.  Make it clear that
   harassment and discrimination are not tolerated.

3. **Issue templates.**  Provide GitHub issue templates for bug reports,
   feature requests, and connector submissions.  Templates should prompt
   users to include reproduction steps, expected behavior, and environment
   details.

4. **Pull request template.**  Include a template that reminds contributors
   to describe their changes, reference related issues, and update tests and
   docs.

## 3. Community Building

1. **Chat channel.**  Create a community chat (e.g., Discord, Slack, or
   Matrix) for users and contributors to ask questions and discuss
   development.  Assign moderators to ensure a welcoming environment.

2. **Discussion forum.**  Enable GitHub Discussions or set up a Discourse
   forum.  Use this for announcements, design proposals, and community help.

3. **Roadmap.**  Publish a roadmap for future features and milestones.  Keep
   it realistic and update it regularly based on community feedback.

4. **Recognition.**  Acknowledge contributors in release notes and in a
   `CONTRIBUTORS.md` file.  Consider a “Hall of Fame” for major
   contributions.

## 4. Compliance and Legal Considerations

1. **License clarity.**  Make it clear that Acsa is released under
   Apache 2.0, which allows commercial use and sublicensing.  Contrast this
   with the restrictions in fair‑code licenses such as n8n’s Sustainable Use
   License【18727317909497†L1723-L1741】.

2. **Third‑party licenses.**  Document the licenses of all dependencies
   (Rust crates and NPM packages).  Ensure compatibility with Apache 2.0.

3. **Trademarks.**  If “Achsah” or “Acsa” becomes a trademark, include a
   trademark notice.  Clarify whether third parties may use the name in
   derived products.

## 5. Launch Strategy

1. **Pre‑release testing.**  Tag release candidates (e.g., `v1.0.0-rc.1`) and
   encourage community members to test them.  Fix critical bugs before the
   stable release.

2. **Announcement.**  Announce the release on Hacker News, Reddit
   (`r/selfhosted`, `r/rust`), X/Twitter, and relevant communities.  Emphasize
   the unique selling points: permissive license, lightweight single binary,
   Git‑native workflows, and agentic AI support.  Highlight that other
   alternatives like Activepieces are popular because they offer a true
   open‑source license【810363192205246†L62-L136】.

3. **Demos and tutorials.**  Publish blog posts and videos demonstrating
   real‑world workflows.  Show how to build a Slack bot, automate a daily
   report, or orchestrate an AI agent.

4. **Feedback loop.**  Monitor GitHub issues, forum posts, and chat
   channels.  Prioritize bug fixes and respond promptly to questions.  Treat
   early adopters as partners in shaping the roadmap.

Following these steps will help ensure that Acsa launches smoothly, builds an
engaged community, and sustains long‑term growth.
