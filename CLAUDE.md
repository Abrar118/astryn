# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Astryn** is a local-first, cross-platform (macOS/Windows/Linux) desktop **power client for Linear** (Tauri v2). Phase 1 covers calendar, issue drawer, drag-to-reschedule, activity timeline, standup/weekly generators, GitHub PR tracking, issue-graph viz, and per-issue doc links.

`requirements.md` is the **authoritative spec and handoff doc** — read it before any feature work. It uses a tag convention you must respect:
- `[REQ]` — hard requirement; do not change without asking.
- `[CHOICE]` — a default decision; swap only with a stated reason.
- `[EXT]` — out of scope now (Slack/Discord, multi-user, OAuth, local-LLM polish). Don't build these, but don't architect in a way that blocks them (provider trait for auth, source-agnostic `activity` table, no-op `polish` hook).

Per-milestone specs and plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`.

## Current status

**M0 (scaffold) is complete** on `main`. Built and installed: Tailwind v4, shadcn/ui (+ Geist font, `tw-animate-css`), TanStack Query, `goey-toast`; Rust side: `sqlx` (SQLite), `keyring`, `reqwest` (rustls), `thiserror`, `tokio`. The Rust backend (secrets/db/linear/commands), the dual-clock Home, and the Settings key flow are working; **24 Rust unit tests pass**. The default `greet` command is gone.

**NOT yet present:** FullCalendar, React Flow, the `github/`, `activity/`, `generators/` Rust modules, and all feature screens beyond Home/Settings.

Build in milestone order (`requirements.md` §11): **M1 next** (calendar + drawer + drag, F1–F3) → … → M6. Each milestone must be independently runnable before starting the next.

## Commands

```bash
npm install              # install JS deps
npm run tauri dev        # PRIMARY dev loop: launches the desktop app (Tauri runs Vite via beforeDevCommand, fixed port 1420)
npm run tauri build      # production desktop bundle (.app/.dmg etc.)
npm run build            # frontend only: tsc typecheck + vite build
npx tsc --noEmit         # typecheck without building
npm run tauri icon <path/to/source.png>   # regenerate src-tauri/icons/ (use a 1024px source for crisp output)

# Rust — use --manifest-path to avoid `cd` (cd into src-tauri can trip a permission prompt)
cargo test  --manifest-path src-tauri/Cargo.toml          # run the unit tests
cargo build --manifest-path src-tauri/Cargo.toml          # compile
cargo clippy --manifest-path src-tauri/Cargo.toml         # lint
cargo fmt   --manifest-path src-tauri/Cargo.toml -- --check   # formatting is kept clean; run without --check to apply
```

- **No JS test framework is configured yet.** Rust logic is unit-tested (`cargo test`). If you add frontend tests, wire the runner + a `test` script.
- TS config is **strict** with `noUnusedLocals`/`noUnusedParameters` — unused symbols fail the build.
- `npm run dev` (Vite-only, browser) won't work for anything using `invoke()` — use `tauri dev`.

## Architecture (the rules that span files)

**Hard rule — all external API calls live in Rust, never the webview** (`requirements.md` §3). The Rust core holds the tokens, executes Linear GraphQL / GitHub REST, writes results to SQLite, and exposes **typed Tauri commands**. The React webview is a pure consumer. Never call Linear/GitHub from the frontend; never pass a token to the webview.

**Data flow:** Linear/GitHub → Rust client → SQLite (cache) → Tauri command → TanStack Query → React. SQLite is a **cache plus a little app-owned data** (`doc_links`, `sync_cursors`, `settings`); Linear is the source of truth for issues. The frontend **never touches SQLite directly**. After any mutation, **upsert the returned entity into SQLite** so the cache stays consistent without a full resync.

**DB location:** `~/Documents/astryn/astryn.db` (resolved via Tauri `document_dir()` + `astryn/`, created on startup; startup fails loudly if the dir or migrations fail). Migrations in `src-tauri/migrations/` run on startup; **only create tables a milestone uses** — so far just `settings` (which also caches the verified Linear viewer name).

**Secrets — two seams, keychain only:**
- `SecretStore` (`secrets/`) = storage trait (`get`/`set`/`delete`), backed by the `keyring` crate. A `FakeSecretStore` backs tests.
- `LinearCredentialProvider` (`linear/`) = supplies the auth credential to `LinearClient`; `PersonalKeyProvider` reads the raw key from `SecretStore` (Linear keys are sent raw, **no `Bearer`**). This is the OAuth-later seam.
- The keyring **backend is target-scoped per OS** in `Cargo.toml` (macOS `apple-native` / Windows `windows-native` / Linux `sync-secret-service`+`crypto-rust`); the `SecretStore` code is identical across all three. Keychain service `com.orion.astryn`, account `linear_api_key`. Keyring calls run off the async executor via `spawn_blocking`.
- **Enforceable secret rule:** the key transits the webview once (user pastes it), is sent through IPC, and is **never returned to TS**, never persisted in browser storage / SQLite / logs / query caches. The Settings save uses a direct async call (NOT a TanStack mutation, whose `variables` would be cached) and clears the input immediately. **`.env` is gitignored and the app does NOT read it** — never wire `.env`-based secret loading.

**Cross-cutting (`requirements.md` §12):** offline-first (opens and shows cached data with no network); optimistic writes with rollback; all sync/error/rate-limit feedback via **`goey-toast`** — note the package is spelled `goey-toast` (imports `GooeyToaster` / `gooeyToast`, plus `goey-toast/styles.css`); do not substitute another toast lib. Tauri commands return **sanitized** errors (no raw reqwest/keyring/GraphQL diagnostics); GraphQL `errors` on HTTP 200 are treated as failures.

**Rust module layout** (`requirements.md` §10): existing — `secrets/`, `db/`, `linear/` (client + GraphQL parse + HTTP-status interpreter + credential provider), `commands/` (thin `#[tauri::command]` wrappers over unit-testable async logic fns + `AppState` + `ConnectionStatus`/`CmdError`). Future — `github/`, `activity/`, `generators/`. Commands are registered in `src-tauri/src/lib.rs` via `tauri::generate_handler![...]`; window permissions in `src-tauri/capabilities/default.json`.

**Frontend layout:** `src/features/<feature>/` (currently `home/`, `settings/`), `src/lib/commands.ts` (hand-maintained typed Tauri bindings + shared types like `ConnectionStatus`), `src/components/ui/` (shadcn), `src/styles/index.css` (Tailwind v4 entry + theme).

**Entry points:** `src-tauri/src/lib.rs` (command registry + `setup` that builds `AppState`), `src/main.tsx` (React root + Query/Toaster providers), `src/App.tsx` (Home/Settings view switch), `src/lib/commands.ts` (typed Tauri boundary).

## Project-specific conventions

- **Time/locale (`[REQ]`, `requirements.md` §3):** ALL date/time logic (due-date bucketing, standup 24h window, weekly window, "Today/Yesterday") is computed in **`Asia/Dhaka`** — not UTC, not machine locale. **Week starts Sunday.** The Home dual clock shows Dhaka + Germany via the **`Europe/Berlin`** IANA zone (DST-aware; never hard-code an offset) using `Intl.DateTimeFormat`.
- **Sync scope:** the entire **`GAM Health Solutions`** Linear workspace (all teams, all issues), not just the user's assignments.
- **Live API wins:** the GraphQL/REST shapes in `requirements.md` are representative — introspect the live Linear schema before relying on field names.
- **Tailwind v4 is CSS-first:** `@import "tailwindcss"` + `@tailwindcss/vite` plugin, theme as CSS variables / `@theme inline` in `src/styles/index.css` — there is **no `tailwind.config.js`**. The dark-first Linear palette lives in the `.dark` block; the app is dark by default (`<html class="dark">`).
- **UI direction:** match Linear's look (dark-first, dense-but-calm, hairline borders, indigo accent, small base size). Font is **Geist** (shadcn default; Inter was the `[CHOICE]` suggestion). Consult the `ui-ux-pro-max` skill **before** building any screen. Source icons/favicons from `public/icons/` before importing any external icon set.
- **Cross-platform build prereqs:** Windows needs WebView2 + MSVC toolchain; Ubuntu needs `libwebkit2gtk-4.1-dev`, `build-essential`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev` and a running Secret Service daemon (`gnome-keyring`). Build natively on each OS.
