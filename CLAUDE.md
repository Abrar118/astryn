# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Astryn** is a local-first desktop **power client for Linear** (Tauri v2 desktop app). Phase 1 covers calendar, issue drawer, drag-to-reschedule, activity timeline, standup/weekly generators, GitHub PR tracking, issue-graph viz, and per-issue doc links.

`requirements.md` is the **authoritative spec and handoff doc** — read it before any feature work. It uses a tag convention you must respect:
- `[REQ]` — hard requirement; do not change without asking.
- `[CHOICE]` — a default decision; swap only with a stated reason.
- `[EXT]` — out of scope now (Slack/Discord, multi-user, OAuth, local-LLM polish). Don't build these, but don't architect in a way that blocks them (provider trait for auth, source-agnostic `activity` table, no-op `polish` hook).

## Current state vs. planned

The repo is currently the **default `create-tauri-app` scaffold** (the `greet` command in `src-tauri/src/lib.rs`, default `src/App.tsx`). The planned stack below — **Tailwind v4, shadcn/ui, sqlx, keyring, reqwest, TanStack Query, FullCalendar, React Flow, gooey-toast — is NOT installed yet.** Work is at milestone **M0 (scaffold)**. Build in milestone order (see `requirements.md` §11): M0 → M1 (calendar+drawer+drag) → … → M6. Each milestone must be independently runnable before starting the next.

## Commands

```bash
npm install              # install JS deps (also triggers cargo build on first tauri run)
npm run tauri dev        # PRIMARY dev loop: launches the desktop app (Tauri runs Vite via beforeDevCommand, fixed port 1420)
npm run tauri build      # production desktop bundle
npm run build            # frontend only: tsc typecheck + vite build
npm run dev              # Vite in browser only — NOTE: anything using `invoke()` needs the Tauri runtime, so prefer `tauri dev`
npx tsc --noEmit         # typecheck without building
npm run tauri icon <path/to/source.png>   # regenerate src-tauri/icons/ from a source image (use 1024px for crisp output)

# Rust (run from src-tauri/)
cargo check              # fast compile check
cargo clippy             # lint
cargo test               # Rust unit tests
```

- **No JS test framework is configured yet.** If you add tests, also wire the runner + a `test` script.
- TS config is **strict** with `noUnusedLocals`/`noUnusedParameters` — unused variables/params fail the build.

## Architecture (the rules that span files)

**Hard rule — all external API calls live in Rust, never the webview** (`requirements.md` §3). The Rust core holds the tokens, executes Linear GraphQL / GitHub REST, writes results to SQLite, and exposes **typed Tauri commands**. The React webview is a pure consumer of local data + command results. Never call Linear/GitHub from the frontend; never pass a token to the webview.

**Data flow:** Linear/GitHub → Rust client → SQLite (cache) → Tauri command → TanStack Query → React. SQLite is a **cache plus a little app-owned data** (`doc_links`, `sync_cursors`, `settings`); Linear is the source of truth for issues. The frontend **never touches SQLite directly** — always go through a command. After any mutation, **upsert the returned entity into SQLite** so the cache stays consistent without a full resync.

**Secrets:** OS keychain only, via the `keyring` crate behind a `SecretStore` trait (the seam for future providers). **Never** store tokens in SQLite, env files, the webview, logs, or commits.

**Cross-cutting requirements (`requirements.md` §12):** offline-first (app opens and shows cached data with no network); optimistic writes with rollback on failure; all sync/error/rate-limit feedback via **`gooey-toast`** (the only sanctioned toast library — do not substitute); explicit shared input/output types across the Tauri command boundary.

**Rust module layout** (target structure in `requirements.md` §10): `commands/` (thin handlers), `linear/` (GraphQL client + sync), `github/` (REST + correlation), `db/` (sqlx + migrations + repositories), `secrets/` (keychain), `activity/` (history→activity transformer), `generators/` (standup/weekly). Tauri commands are registered in `src-tauri/src/lib.rs` via `tauri::generate_handler![...]`; window permissions live in `src-tauri/capabilities/default.json`.

**SQLite migrations** live in `src-tauri/migrations/` and run on startup. The full schema is specified in `requirements.md` §5, but **only create tables a milestone actually uses** — schema grows per milestone.

## Project-specific conventions

- **Time/locale (`[REQ]`, `requirements.md` §3):** ALL date/time logic (due-date bucketing, standup 24h window, weekly window, "Today/Yesterday" grouping) is computed in **`Asia/Dhaka`** — not UTC, not machine locale. **Week starts Sunday.** The home dual clock shows Dhaka + Germany using the **`Europe/Berlin`** IANA zone (DST-aware; never hard-code a UTC offset).
- **Sync scope:** the entire **`GAM Health Solutions`** Linear workspace (all teams, all issues), not just the user's assignments.
- **Live API wins:** the GraphQL/REST shapes in `requirements.md` are representative — introspect the live Linear schema before relying on field names.
- **Tailwind v4 is CSS-first:** config via `@theme` in the stylesheet with `@import "tailwindcss"` and the `@tailwindcss/vite` plugin — there is no `tailwind.config.js`. Define the dark-first Linear palette as `@theme` tokens so shadcn inherits it.
- **UI direction:** match Linear's look (dark-first, dense-but-calm, hairline borders, indigo accent, ~13–14px Inter). Consult the `ui-ux-pro-max` skill **before** building any screen. Source icons/favicons from `public/icons/` before importing any external icon set.
