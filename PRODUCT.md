# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Rendered in a Tauri 2 desktop webview on macOS, Windows, and Linux. Desktop-only; no mobile or browser-hosted target.

## Users

One person: the owner, a software engineer at GAM Health Solutions who works across an issue tracker, code hosting, team chat, and internal docs all day. Astryn is a single-user personal tool; multi-user and team sharing are out of scope.

## Product Purpose

A local-first desktop workspace that pulls the owner's work tools into one fast, keyboard-driven surface: issues on a real calendar, a due-date week agenda, inline issue editing, PR review status, chat catch-up, docs, and generated daily/weekly reports. Success means the owner can see what needs attention and act on it without opening each tool's own UI, including when offline.

## Positioning

Astryn is a modular hub, not a client for one service. Every integration, including the issue tracker, is a module the owner can enable, disable, or add as their tool stack changes (for example turning Slack off, adding Microsoft Teams, adding Bitbucket alongside or instead of GitHub, or swapping the tracker). Credentials, sync, and caching live in a local Rust core, so the app stays useful offline and no token ever reaches the UI.

## Operating Context

- Open all day beside the tools it aggregates; used in short check-ins and longer planning sessions.
- Work-week logic runs on Asia/Dhaka time with a Sunday week start; the owner also tracks Germany (Europe/Berlin) time for collaborators.
- Current integrations: Linear (tracker), Local tasks (a second, local-only tracker alongside or instead of Linear), GitHub (PRs, contribution heatmap, docs source), Bitbucket Cloud (PRs), local folders (docs source: Markdown, text, PDF), ClickUp (Docs as a docs source), Slack (read-only catch-up), Microsoft Teams (read-only chat catch-up), any OpenAI-compatible LLM endpoint (report prose).

## Capabilities and Constraints

- Shipped surfaces: Dashboard, Calendar, Issues (list/board), issue drawer and full-page issue view (with per-task Docs & links), This Week agenda, dependency graph, PR workspace (GitHub) and Bitbucket PRs, Slack and Teams catch-up boards, Local tasks (list, board, table, calendar, timeline), Docs browser, Reports, Inbox, Settings, first-run module picker, command palette, two-pane split view.
- Module system is built. Every integration and feature is a module the owner turns on or off in Settings → Modules (enforced in the Rust core); disabling keeps tokens and cache, and "Remove module data" deletes them. Calendar, This Week, Dependencies, the issue drawer, Dashboard and Reports read one tracker-neutral task model that merges every active tracker. Linear's Issues, This Week, Dependencies and Inbox screens can also be switched off one by one.
- All external requests run in the Rust core; the UI only calls typed local commands. Secrets live in the OS keychain.
- Offline-first: cached screens must stay useful without network; edits are optimistic with visible rollback.
- Where a surface represents Linear data (issues, drawer, comments, states), its UX should feel familiar to Linear users. Elsewhere, Linear's look is a reference, not a requirement; better UX wins.

## Brand Commitments

- Name: Astryn. App icon set in `public/icons/`.
- Sober, matte visual character. No gradients and no "AI-style" color treatments (glows, neon accents, purple-to-blue washes).
- Multiple selectable color themes, not a single fixed palette.

## Evidence on Hand

- Product spec and history: `requirements.md`, `docs/superpowers/specs/`, `README.md`.
- No users other than the owner, no testimonials, metrics, or public positioning claims exist; do not invent them.

## Product Principles

1. Attention first: surface what needs action now, ranked, before anything else.
2. Modules, not hard-wiring: every integration can be turned off without breaking the rest, and a new one can be added without touching unrelated surfaces.
3. Local and trustworthy: works offline, never leaks credentials, never loses an edit silently.
4. Fast hands: every flow is reachable and completable from the keyboard.
5. Calm over clever: built for all-day use, so restraint beats decoration.

## Accessibility & Inclusion

- Keyboard-first: every flow fully operable from the keyboard (command palette, shortcuts, focus management).
- WCAG 2.2 AA contrast for text and UI in every shipped theme.
