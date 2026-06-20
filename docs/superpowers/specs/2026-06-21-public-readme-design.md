# Public README Design

**Date:** 2026-06-21
**Status:** Approved

## Goal

Replace the starter Tauri README with a polished, public-facing introduction to Astryn and add an Apache-2.0 license attributed to Abrar Mahir Esam - ME.

## Audience And Positioning

The README serves prospective users, contributors, and people evaluating the project. It presents Astryn first as a useful desktop product, then provides enough technical detail to build and understand it.

Astryn is positioned as a local-first desktop power client for Linear and the first phase of a broader personal command center. The README describes only capabilities already present in the repository; future work is clearly labeled as roadmap rather than shipped functionality.

## README Structure

1. Product name and concise premise.
2. Linked Shields.io badges styled like connected metadata chips for version, Tauri, React, TypeScript, and Apache-2.0.
3. Product overview explaining the workflow problem Astryn solves.
4. Current feature list covering calendar scheduling, issue details and editing, tabbed split-view workspace, command palette, inbox, local caching, secure credentials, comments, and rich Markdown.
5. Architecture and privacy section describing the Tauri/Rust boundary, SQLite cache, OS keychain, and React frontend.
6. Requirements, installation, and development commands based on the repository's existing scripts.
7. Current scope and a concise roadmap that does not imply unfinished features are available.
8. License section linking to the Apache-2.0 license file and naming the copyright holder.

The README will not include unsupported release/download instructions, fabricated screenshots, contribution policies that do not exist, or claims that future GitHub/Slack/Discord functionality is already implemented.

## License

Add the standard Apache License 2.0 text as the root `LICENSE` file. The README will identify the project as licensed under Apache-2.0 and attribute copyright to `Abrar Mahir Esam - ME`.

## Verification

- Confirm all README commands exist in `package.json` or the repository guidelines.
- Confirm every listed feature has an implementation in the current source tree.
- Confirm badge URLs render through Shields.io and the license badge links to `LICENSE`.
- Confirm `LICENSE` contains the unmodified Apache License 2.0 text.
- Run a Markdown/link-oriented manual review and `git diff --check`.
