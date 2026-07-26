# Repository Guidelines

## Start Here

Astryn is a local-first Tauri 2 desktop client built with a React 19/TypeScript
webview and a Rust backend.

- Read `requirements.md` before feature work. It is the product authority:
  `[REQ]` items are mandatory, `[CHOICE]` items may change only with a stated
  reason, and `[EXT]` items are out of scope.
- Use `CLAUDE.md` for deeper architectural rationale, but verify status and
  milestone claims against the current tree, package manifests, migrations, and
  Git history; status prose can lag behind implementation.
- Inspect `git status --short --branch` before editing. The working tree may
  contain another agent's changes; preserve them and keep your diff scoped.
- Prefer the smallest change that solves the requested behavior. Do not bundle
  unrelated cleanup, dependency upgrades, or architectural refactors.

## Project Map

Frontend code lives in `src/`:

- `main.tsx` installs the React, TanStack Query, and router providers.
- `App.tsx` mounts the application shell and global toaster.
- `features/` contains product areas such as calendar, agenda, issues, drawer,
  inbox, PRs, Slack, docs, reports, settings, and command palette.
- `components/` contains shared application components; reusable primitives
  live under `components/ui/` when applicable.
- `lib/commands.ts` is the hand-maintained typed Tauri IPC boundary.
- `lib/queries.ts` and adjacent modules own frontend server-state coordination,
  optimistic updates, and shared domain helpers.
- `styles/index.css` is the Tailwind v4 entry and theme source. Tailwind is
  CSS-first; there is no `tailwind.config.js`.
- Co-locate frontend tests as `*.test.ts` or `*.test.tsx`.

The Rust application lives in `src-tauri/`:

- `src/lib.rs` builds `AppState`, initializes the database and credential
  providers, and registers every Tauri command.
- `src/commands/` contains thin IPC wrappers and unit-testable command logic.
- `src/linear/`, `src/github/`, and `src/slack/` contain provider clients,
  response parsing, authentication seams, and sync logic.
- `src/db/` owns SQLite access; `src/generators/` owns report facts and LLM
  generation; `src/link_preview/` owns bounded, SSRF-aware preview fetching.
- `migrations/` contains ordered SQLx migrations. Add a new numbered migration
  instead of rewriting one that may already have run.
- `capabilities/default.json` defines webview permissions, while
  `tauri.conf.json` defines packaging, window settings, and CSP.

Imported frontend assets belong in `src/assets/`. Files whose URL or filename
must remain stable belong in `public/`; reuse `public/icons/` and the existing
`lucide-react` dependency before adding another icon source.

## Non-Negotiable Architecture

- All outbound Linear, GitHub, Slack, document-source, image-proxy, and link
  preview requests run in Rust. The webview calls typed Tauri commands and must
  not call provider APIs directly.
- Credentials stay in the OS keychain. Never return tokens to TypeScript or
  write them to SQLite, browser storage, environment files, logs, errors, or
  query caches.
- SQLite is an offline cache plus limited app-owned state; remote providers
  remain the source of truth. After a successful mutation, update the cache
  from the returned entity so local reads do not require a full resync.
- Keep Tauri command errors sanitized. Do not expose raw reqwest, keyring,
  GraphQL, filesystem, or database diagnostics to the webview.
- Use TanStack Query for remote/cache-backed frontend state and `goey-toast`
  for user-visible sync, mutation, rate-limit, and error feedback.
- Treat capability and CSP changes as security-sensitive. Add the narrowest
  permission or origin required and call it out explicitly in review notes.
- Preserve generation/cancellation guards around sync and long-running work;
  stale async results must not overwrite state created by a newer request.

## Product Conventions

- All product date bucketing and work-week logic uses `Asia/Dhaka`; the week
  starts Sunday. Germany time uses `Europe/Berlin` so DST is handled by the
  IANA timezone database. Do not substitute UTC, machine locale, or fixed
  offsets.
- Keep the UI dark-first, compact, keyboard-friendly, and visually consistent
  with the existing Linear-inspired surfaces. Reuse existing components and
  theme tokens instead of inventing parallel patterns.
- Maintain offline behavior: cached screens should remain useful when provider
  requests fail, and optimistic writes need an explicit rollback path.
- Live provider schemas and responses win over examples in documentation.
  Validate external fields and handle GraphQL `errors` even on HTTP 200.

## Build and Development Commands

```bash
npm install
npm run tauri dev
npm run dev
npm test
npm run build
npx tsc --noEmit

cargo build --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check

npm run tauri build
```

`npm run tauri dev` is the primary development loop. `npm run dev` starts only
Vite, so flows that call `invoke()` require the full Tauri app. Desktop bundles
must be built natively on each target OS.

## Coding Conventions

- TypeScript is strict. Keep it free of unused locals and parameters, use
  two-space indentation, double quotes, semicolons, and trailing commas.
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
- Do not edit generated output under `dist/`, `node_modules/`, or
  `src-tauri/target/`.

## Testing and Verification

Write a focused regression test before fixing a confirmed bug. Test observable
behavior rather than implementation details.

- Frontend-only changes: run the focused Vitest file, then `npm test` and
  `npm run build`.
- Rust-only changes: run the focused Rust test, then
  `cargo test --manifest-path src-tauri/Cargo.toml` and
  `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- Cross-boundary changes: run both frontend and Rust suites and verify that IPC
  names, argument casing, serialization, and TypeScript types agree.
- Database changes: add migration and database tests; exercise startup/migration
  behavior against a temporary database.
- Capability, CSP, or packaging changes: run the relevant Tauri flow and explain
  the security or platform impact.
- Manually exercise affected desktop behavior with `npm run tauri dev` when the
  environment permits. Do not claim manual verification if it was not run.

Before handoff, inspect `git diff --check`, review the complete scoped diff, and
report the exact commands run plus any pre-existing warnings or untested manual
paths.

## Commits and Pull Requests

Git history is available; use it to understand recent decisions and conventions.
Use concise imperative commits, preferably Conventional Commit style, and keep
each commit focused.

Pull requests should include:

- the user-visible change and root cause;
- the exact verification commands and results;
- the relevant requirement, issue, or design decision;
- screenshots or recordings for visual changes;
- explicit notes for migrations, Tauri capabilities/CSP, secrets, or packaging.

Branch from the latest target branch when asked to publish work. Never stage,
overwrite, discard, or commit unrelated working-tree changes, and do not push,
open a PR, or merge unless the user requested that external action.
