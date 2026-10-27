# Repository Guidelines

Shared instructions for every coding agent (Codex, Claude Code, …). `CLAUDE.md`
only imports this file — edit here, not there.

## Start Here

Astryn is a local-first, cross-platform (macOS/Windows/Linux) Tauri 2 desktop
power client for Linear, built with a React 19/TypeScript webview and a Rust
backend.

- Read `requirements.md` before feature work. It is the product authority:
  `[REQ]` items are mandatory, `[CHOICE]` items may change only with a reason
  stated in the commit/PR, and `[EXT]` items are out of scope — don't build
  them, but don't architect in a way that blocks them.
- Shipped/remaining work is tracked in `requirements.md` ("Implementation
  status" and §11 Milestones). Verify those claims against the tree,
  manifests, migrations, and Git history; status prose can lag. Next up is
  M6 (F9 per-issue doc links). Each milestone must build and run on its own
  before the next starts.
- Per-feature design specs and plans live in `docs/superpowers/specs/` and
  `docs/superpowers/plans/`.
- `PRODUCT.md` (product truth: user, principles, constraints) and `DESIGN.md`
  (visual system, once written) at the repo root are read by the `impeccable`
  design skill. Keep them current when product direction or the visual system
  changes.
- Planned direction: every integration, including the issue tracker, becomes a
  module that can be enabled, disabled, or added (`requirements.md` §3 Module
  architecture). New provider code should stay self-contained behind its own
  client, credential provider, commands, tables, and feature folder so it can
  be toggled later; don't add new hard-wired cross-provider coupling.
- Inspect `git status --short --branch` before editing. The working tree may
  contain another agent's changes; preserve them and keep your diff scoped.
- Read the code you are changing before making claims about it, and trace a
  bug to its root before fixing it.

## Project Map

Frontend code lives in `src/`:

- `main.tsx` installs the React, TanStack Query, and router providers.
- `App.tsx` mounts the application shell and global toaster.
- `features/` contains product areas such as dashboard, calendar, agenda,
  issues, drawer, inbox, PRs, Slack, docs, reports, settings, and command
  palette.
- `components/` contains shared application components; shadcn primitives
  live under `components/ui/`.
- `lib/commands.ts` is the hand-maintained typed Tauri IPC boundary and the
  only place that calls `invoke()`.
- `lib/queries.ts` and adjacent modules own frontend server-state coordination,
  optimistic updates, and shared domain helpers.
- `styles/index.css` is the Tailwind v4 entry and theme source. Tailwind is
  CSS-first (`@import "tailwindcss"`, `@theme inline`); there is no
  `tailwind.config.js`. The dark palette lives in the `.dark` block and
  `<html class="dark">` is the default.

The Rust application lives in `src-tauri/`:

- `src/lib.rs` builds `AppState`, initializes the database and credential
  providers, and registers every Tauri command in `generate_handler![...]`.
- `src/commands/` contains thin IPC wrappers and unit-testable command logic.
- `src/linear/`, `src/github/`, and `src/slack/` contain provider clients,
  response parsing, credential-provider seams, and sync logic.
- `src/secrets/` is the `SecretStore` trait (keyring-backed; `FakeSecretStore`
  for tests).
- `src/db/` owns SQLite access; `src/generators/` owns report facts and LLM
  generation; `src/link_preview/` owns bounded, SSRF-aware preview fetching.
- `migrations/` contains ordered SQLx migrations that run on startup. Add a new
  numbered migration instead of rewriting one that may already have run, and
  only create tables the feature actually uses.
- `capabilities/default.json` defines webview permissions, while
  `tauri.conf.json` defines packaging, window settings, and CSP.

Imported frontend assets belong in `src/assets/`. Files whose URL or filename
must remain stable belong in `public/`; reuse `public/icons/` and the existing
`lucide-react` dependency before adding another icon source.

## Non-Negotiable Architecture

- All outbound Linear, GitHub, Slack, LLM, document-source, image-proxy, and
  link-preview requests run in Rust. The webview calls typed Tauri commands and
  must not call provider APIs directly. Data flow: provider → Rust client →
  SQLite → Tauri command → TanStack Query → React.
- SQLite is an offline cache plus limited app-owned state; remote providers
  remain the source of truth. The frontend never touches SQLite. After a
  successful mutation, upsert the returned entity into the cache so local reads
  do not require a full resync.
- The DB is `astryn.db` in Tauri's `app_data_dir()` (`com.orion.astryn`).
  Never move it under `~/Documents`: that folder is TCC-protected on macOS and
  SQLite fails with `SQLITE_CANTOPEN`. Startup fails loudly if the dir or
  migrations fail.
- Keep Tauri command errors sanitized. Do not expose raw reqwest, keyring,
  GraphQL, filesystem, or database diagnostics to the webview. GraphQL `errors`
  on HTTP 200 are failures.
- Use TanStack Query for remote/cache-backed frontend state and `goey-toast`
  for user-visible sync, mutation, rate-limit, and error feedback. The package
  is spelled `goey-toast` but exports `GooeyToaster` / `gooeyToast` (plus
  `goey-toast/styles.css`); do not substitute another toast library.
- Treat capability and CSP changes as security-sensitive. Add the narrowest
  permission or origin required and call it out explicitly in review notes.
- Preserve generation/cancellation guards around sync and long-running work;
  stale async results must not overwrite state created by a newer request.

## Secrets

- Credentials live only in the OS keychain (service `com.orion.astryn`;
  accounts such as `linear_api_key`, `github_token`, `slack_user_token`,
  `slack_cookie_d`, `llm_api_key`). Never return them to TypeScript or write
  them to SQLite, browser storage, logs, errors, query caches, or commits.
- A key transits the webview once (the user pastes it) and goes over IPC.
  Settings saves use a direct async call, not a TanStack mutation (whose
  `variables` would be cached), and clear the input immediately.
- `.env` is gitignored and the app does not read it. Never wire `.env`-based
  secret loading.
- Auth goes through provider seams (`LinearCredentialProvider`,
  `GitHubCredentialProvider`, `SlackCredentialProvider`) so OAuth can slot in
  later. Linear personal keys are sent raw in `Authorization` (no `Bearer`).
- The keyring backend is selected per OS in `Cargo.toml`; `SecretStore` code is
  identical across platforms. Run keyring calls off the async executor
  (`spawn_blocking`).

## Product Conventions

- All product date bucketing and work-week logic uses `Asia/Dhaka`; the week
  starts Sunday. Germany time uses `Europe/Berlin` via `Intl.DateTimeFormat` so
  DST is handled by the IANA database. Do not substitute UTC, machine locale,
  or fixed offsets.
- Linear sync scope is the entire `GAM Health Solutions` workspace (all teams,
  all issues), not only the viewer's assignments.
- UI direction (`requirements.md` §3): sober, matte, dense-but-calm, dark by
  default, Geist font. No gradients, glows, neon, or "AI-style" color washes.
  Linear is a reference, not a mandate: surfaces that show Linear data keep
  Linear-familiar UX; elsewhere better UX wins. Every theme must meet WCAG 2.2
  AA contrast, and every flow must work from the keyboard. Reuse existing
  components and theme tokens instead of inventing parallel patterns.
- Use the `impeccable` skill (`.claude/skills/`, `.agents/skills/`) for UI work:
  `shape` before a new screen, `critique`/`audit`/`polish`/`harden` on
  existing ones. Its PostToolUse/Stop hooks scan UI edits for anti-patterns.
- Maintain offline behavior: cached screens should remain useful when provider
  requests fail, and optimistic writes need an explicit rollback path with a
  visible error.
- Live provider schemas and responses win over examples in documentation.
  Introspect the live Linear schema before relying on field names.

## Build and Development Commands

```bash
npm install
npm run tauri dev        # primary loop: desktop app + Vite on fixed port 1420
npm run dev              # Vite only; anything using invoke() will not work
npm test                 # Vitest
npm run build            # tsc typecheck + vite build
npx tsc --noEmit
npm run tauri icon <1024px-source.png>   # regenerate src-tauri/icons/

# Use --manifest-path instead of cd-ing into src-tauri
cargo build  --manifest-path src-tauri/Cargo.toml
cargo test   --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml
cargo fmt    --manifest-path src-tauri/Cargo.toml -- --check

npm run tauri build      # bundles to src-tauri/target/release/bundle/
```

Desktop bundles must be built natively on each target OS. Windows needs
WebView2 + MSVC; Linux needs `libwebkit2gtk-4.1-dev`, `build-essential`,
`libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, and a running
Secret Service daemon (e.g. `gnome-keyring`).

## Coding Conventions

- TypeScript is strict with `noUnusedLocals`/`noUnusedParameters`; unused
  symbols fail the build. Use two-space indentation, double quotes,
  semicolons, and trailing commas (`.editorconfig`; Rust uses four spaces).
- Name React components and component files in `PascalCase`; hooks, functions,
  and variables use `camelCase`; CSS classes use lowercase kebab-case.
- Prefer the `@/` alias for cross-feature frontend imports. Keep feature-only
  code within its feature directory and avoid new catch-all utility modules.
- Do not duplicate Rust and TypeScript domain contracts casually. When a Tauri
  payload changes, update its Rust serialization, TypeScript type/binding, all
  consumers, and boundary tests together.
- Keep `#[tauri::command]` functions small. Put parsing, validation, database
  work, and provider logic in ordinary functions that can be unit tested.
- Use Rust `snake_case`, run `cargo fmt`, and avoid blocking filesystem,
  keychain, or network work on the async executor.
- Write the simplest code that works: reuse what exists, then the standard
  library, then installed dependencies; never add a dependency for a few lines.
  Fix bugs in the shared function, not per caller. Never simplify away
  validation, security, data-loss handling, or accessibility.
- Do not bundle unrelated cleanup, dependency upgrades, or refactors, and do
  not add speculative features or defensive code for impossible cases.
- Do not edit generated output under `dist/`, `node_modules/`, or
  `src-tauri/target/`.

## Testing and Verification

Write a focused regression test before fixing a confirmed bug, and leave one
small runnable check for any non-trivial logic. Test observable behavior rather
than implementation details.

- Frontend tests are co-located as `*.test.ts(x)`. Vitest defaults to the
  `node` environment; tests that render React need a
  `// @vitest-environment jsdom` first line. `@tauri-apps/api/core` and
  `@tauri-apps/plugin-opener` are aliased to stubs in `src/__mocks__/`.
- Rust tests are inline `#[cfg(test)]` modules; use `FakeSecretStore` and a
  temporary database rather than the real keychain or app DB.
- Frontend-only changes: run the focused Vitest file, then `npm test` and
  `npm run build`.
- Rust-only changes: run the focused Rust test, then `cargo test`, `cargo
  clippy`, and `cargo fmt -- --check` (with `--manifest-path`).
- Cross-boundary changes: run both suites and verify that IPC names, argument
  casing, serialization, and TypeScript types agree.
- Database changes: add migration and database tests; exercise startup/migration
  behavior against a temporary database.
- Capability, CSP, or packaging changes: run the relevant Tauri flow and explain
  the security or platform impact.
- Manually exercise affected desktop behavior with `npm run tauri dev` when the
  environment permits. Do not claim manual verification if it was not run.

Before handoff, inspect `git diff --check`, review the complete scoped diff, and
report the exact commands run plus any pre-existing warnings or untested manual
paths.

## Review Feedback

When given a review, critique, or list of suggestions, verify each claim
against the code (confirmed / refuted / unclear, with evidence) before agreeing
or changing anything.

## Commits and Pull Requests

Git history is available; use it to understand recent decisions and conventions.
Use concise imperative commits in Conventional Commit style
(`feat(prs): …`, `fix(issues): …`), and keep each commit focused.

Pull requests should include:

- the user-visible change and root cause;
- the exact verification commands and results;
- the relevant requirement, issue, or design decision;
- screenshots or recordings for visual changes;
- explicit notes for migrations, Tauri capabilities/CSP, secrets, or packaging.

Branch from the latest target branch when asked to publish work. Never stage,
overwrite, discard, or commit unrelated working-tree changes, and do not push,
open a PR, or merge unless the user requested that external action.
