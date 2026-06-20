# Astryn

[![Version](https://img.shields.io/badge/release-v0.1.0-E8794B?style=flat-square)](https://github.com/Abrar118/astryn)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-78B83E?style=flat-square)](LICENSE)

**A local-first desktop power client for Linear, built for planning work instead of managing browser tabs.**

Astryn brings issue planning, scheduling, triage, and deep issue work into one fast desktop workspace. It combines a real calendar with a dense Linear-style interface, cache-backed reads, secure credentials, and a tabbed workspace that can split into two independent panes.

Astryn is the first phase of a broader personal command center. Today it focuses on Linear; future phases can bring related development and communication context into the same local workspace.

> Astryn is an independent project and is not affiliated with or endorsed by Linear.

## Features

- **Calendar planning** with month, week, and day views, due-date scheduling, filters, and drag-to-reschedule.
- **Issue workspace** with list and board views, display controls, and cached search/filter data.
- **Rich issue details** in a side drawer or full-page tab, including inline properties, descriptions, comments, reactions, relations, sub-issues, attachments, and activity.
- **Two-pane split view** with independent tab groups, drag-to-split, pane swapping, keyboard resizing, and persisted layout state.
- **Command palette** for navigation, issue search, creation, sync actions, and opening a selected issue directly in the right split.
- **Inbox** for issue-related notifications with inline detail viewing.
- **Local-first data layer** backed by SQLite for fast cache reads and resilient workspace state.
- **Secure authentication** with Linear credentials stored in the operating system keychain, never in the webview or SQLite.
- **Markdown editing** with GitHub-flavored Markdown, Mermaid diagrams, code blocks, images, and issue mentions.
- **Optimistic updates and background sync** with rollback handling and visible sync status.

## Premise

Linear is the source of truth; Astryn is the focused desktop workspace around it. The Rust core owns credentials, API access, synchronization, and SQLite persistence. The React renderer consumes typed Tauri commands and never receives API secrets.

This boundary keeps the local cache authoritative for the interface while preserving Linear as the canonical remote system.

## Architecture

| Layer | Responsibility |
| --- | --- |
| Tauri 2 | Desktop shell, command boundary, packaging |
| Rust | Linear API access, keychain integration, sync, SQLite |
| React 19 + TypeScript | Workspace, calendar, issue editing, command palette |
| TanStack Query | Renderer-side server-state coordination and optimistic updates |
| SQLite | Local issue cache, sync state, and app-owned metadata |

All outbound Linear requests run in Rust. Tokens are stored through the OS keychain and are not written to local storage, SQLite, or frontend environment files.

## Requirements

- Node.js 20 or newer
- Rust stable toolchain
- [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system
- A Linear personal API key

## Development

```bash
npm install
npm run tauri dev
```

Useful checks:

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

Run only the web frontend with `npm run dev`. The full application requires `npm run tauri dev` so the Rust commands, SQLite cache, and keychain integration are available.

## Current Scope

Astryn currently targets a single-user Linear workflow. Planned directions include generated standup and weekly-review views, GitHub pull-request context, issue relationship visualization, local reference links, and additional activity sources.

## License

Licensed under the [Apache License 2.0](LICENSE).

Copyright 2026 Abrar Mahir Esam - ME.
