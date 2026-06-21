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

### Calendar & scheduling

- **Month and week views** (FullCalendar) computed in `Asia/Dhaka` with weeks starting Sunday.
- **Drag-to-reschedule** — drag an event to another day to update its due date, with optimistic updates and rollback on failure.
- **Unscheduled rail** — issues without a due date sit in a side rail; drag one onto a day to schedule it.
- **Color by state or priority**, filters for team / assignee (defaults to you) / project, and clear overdue flagging.
- **Rich issue hover-card** on event chips and a full **right-click issue menu** for inline edits.

### Issue workspace

- **List view** grouped by status, assignee, priority, or project, with display controls (ordering, completed-issue handling, sub-issue visibility, per-column toggles) that persist across launches.
- **Board view** — a Kanban grouped by status / assignee / priority; drag cards between columns to apply the implied change.
- **Create issues** from a modal or the command palette, with team, state, priority, due date, assignee, labels, project, cycle, and estimate.
- **Right-click context menu** on any issue for fast edits, copy actions, "open in Linear", "open in full page", and "open in right split".

### Issue details

- **Shared detail view** rendered either as a side drawer (non-modal — the calendar stays interactive) or as a full-page workspace tab.
- **Inline-editable properties**: state, assignee, priority, due date, title, labels, project, cycle, estimate, and team.
- **Markdown description editor** (Milkdown) with GitHub-flavored Markdown, Mermaid diagrams, fenced code blocks, images (proxied through Rust), and issue mentions with hover previews.
- **Comments** — Linear-style threads with replies, emoji reactions, `@`-mentions, and mention hover-cards; create, edit, and delete.
- **Sub-issues, relations, attachments**, and a per-issue **activity timeline** with semantic, color-coded event icons.

### Planning & overview

- **"This Week" overview** — your issues grouped by due date for the current Sunday-started week (`Asia/Dhaka`): an **Overdue** group, one section per weekday, and a **Weekend** group, with threaded sub-issues and related issues, sticky day headers, an activity heatmap, and status/priority breakdowns.
- **Dependency graph** — a React Flow visualization of parent/child hierarchy and issue relations (blocks / blocked-by / related / duplicate) as styled edges, with grouping and bulk actions; click a node to open its detail.

### GitHub pull requests

- **Standalone PR dashboard** of open PRs that involve you across every accessible repo — four sections: **Needs my review**, **My open PRs**, **Assigned to me**, and **Involved / mentioned** (resolved via `@me` search, deduped per section).
- **Per-PR badges** — open/draft, CI status, merge-conflict, and review decision (including "changes requested" on your own PRs), alongside author + avatar, comment count, repo, and relative update time.
- **GitHub contribution heatmap** — your real contribution calendar for the last year rendered at the top of the page, beside Open / Needs-review / Changes-requested / Conflict metric tiles.
- **Linear chip** — a PR whose branch or title carries an issue identifier (e.g. `ENG-123`) links straight to that issue's tab in Astryn.
- **Classic PAT** stored in the OS keychain; degrades to a quiet "Connect GitHub" prompt when no token is set. Offline-first per-bucket cache with background sync.

### Workspace & navigation

- **Browser-style tabs** — calendar, issues, overview, dependencies, pull requests, inbox, settings, or a pinned issue, each in its own tab; layout persists across reloads.
- **Two-pane split view** — split the workspace into two independent tab groups with a resizable divider (pointer and keyboard), pane swapping, and drag-to-split.
- **Three ways to fill the right pane**: drag a tab across, right-click a tab to split, or pick an issue from the issue context menu / command palette.
- **Drag-and-drop on @dnd-kit** for both tabs (reorder, move across panes, drag-to-split) and board cards — pointer **and** keyboard accessible.
- **Command palette** (`⌘/Ctrl + K`) for issue search, creation, go-to navigation (Calendar / Issues / Overview / Dependencies / Pull Requests / Inbox / Settings), resync actions, and opening a selected issue directly in the right split.
- **Keyboard shortcuts**: `⌘/Ctrl + T` new tab, `⌘/Ctrl + [` back, `⌘/Ctrl + R` resync, `⌘/Ctrl + Shift + R` full resync, and `C` to create an issue.

### Inbox

- **Linear notifications** in the dock, in a master-detail layout that reuses the shared issue detail for inline viewing, with explicit error and "all caught up" states.

### Foundation

- **Local-first data layer** backed by SQLite for fast cache reads and resilient, persisted workspace state.
- **Secure authentication** — Linear and GitHub credentials stored in the operating-system keychain, never in the webview or SQLite.
- **All external API calls (Linear & GitHub) run in Rust**, exposed to the renderer as typed Tauri commands; the webview never receives a token.
- **Optimistic updates and background sync** with rollback handling, and all sync / error / rate-limit feedback through `goey-toast`.
- **Home dual clock** showing your local Dhaka time alongside Germany (`Europe/Berlin`, DST-aware).

> **Roadmap (not yet built):** per-issue reference link storage (docs & links per issue). See [`requirements.md`](requirements.md) for the full plan.

## Premise

Linear is the source of truth; Astryn is the focused desktop workspace around it. The Rust core owns credentials, API access, synchronization, and SQLite persistence. The React renderer consumes typed Tauri commands and never receives API secrets.

This boundary keeps the local cache authoritative for the interface while preserving Linear as the canonical remote system.

## Architecture

| Layer | Responsibility |
| --- | --- |
| Tauri 2 | Desktop shell, command boundary, packaging |
| Rust | Linear & GitHub API access, keychain integration, sync, SQLite |
| React 19 + TypeScript | Workspace, calendar, issue editing, command palette |
| TanStack Query | Renderer-side server-state coordination and optimistic updates |
| SQLite | Local issue cache, sync state, and app-owned metadata |

All outbound Linear and GitHub requests run in Rust. Tokens are stored through the OS keychain and are not written to local storage, SQLite, or frontend environment files.

## Requirements

- Node.js 20 or newer
- Rust stable toolchain
- [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system
- A Linear personal API key (added in the app's Settings on first run)
- *(Optional)* a GitHub **classic** personal access token (`repo` scope) for the pull-request dashboard

## Development

```bash
npm install
npm run tauri dev
```

`npm run tauri dev` is the primary loop: it launches the desktop app and runs Vite for you, so the Rust commands, SQLite cache, and keychain integration are all available. (`npm run dev` starts only the web frontend and cannot reach the Rust backend.)

## Building installers

Astryn packages to native installers for each platform via Tauri.

```bash
# Production desktop build for the current OS
npm run tauri build
```

Output lands in `src-tauri/target/release/bundle/`. The window's `targets` is set to `all`, so each OS produces its native formats:

- **macOS** — `.app` and `.dmg`
- **Windows** — `.msi` and NSIS `.exe` (requires WebView2 + the MSVC toolchain)
- **Linux** — `.deb` and `.AppImage` (requires `libwebkit2gtk-4.1-dev`, `build-essential`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, and a running Secret Service daemon such as `gnome-keyring`)

Tauri does not cross-compile desktop bundles — build each target on its own operating system.

## Quality checks

```bash
npm test                                                  # frontend tests (Vitest)
npm run build                                             # tsc typecheck + Vite build (frontend only)
cargo test  --manifest-path src-tauri/Cargo.toml          # Rust unit tests
cargo clippy --manifest-path src-tauri/Cargo.toml         # Rust lints
cargo fmt   --manifest-path src-tauri/Cargo.toml -- --check # Rust formatting
```

## Current scope

Astryn currently targets a single-user Linear workflow and delivers the calendar, issue workspace, detail editing, activity timeline, the "This Week" overview, the dependency graph, the GitHub pull-request dashboard, the inbox, the command palette, and the two-pane split workspace. Planned directions include per-issue reference links (docs & links) and additional activity sources.

## License

Licensed under the [Apache License 2.0](LICENSE).

Copyright 2026 Abrar Mahir Esam - ME.
