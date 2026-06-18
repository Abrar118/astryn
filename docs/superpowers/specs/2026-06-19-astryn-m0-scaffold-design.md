# Astryn M0 — Scaffold (Design Spec)

**Status:** Approved (design review incorporated)
**Scope:** Milestone M0 only — see `requirements.md` for full Phase-1 context.
**Date:** 2026-06-19

---

## 1. Goal

Turn the current vanilla `create-tauri-app` scaffold into the Astryn foundation: real styling, a working **DB + secrets + Linear-proxy pipeline in Rust**, and two functional screens (Home, Settings). M0 establishes reliable seams for M1+ and proves the end-to-end path (webview → Tauri command → Rust → keychain/SQLite/Linear) with the `viewer` smoke test. **No issue data, calendar, sidebar, or command palette** — those are M1+.

## 2. Starting point

Current repo is the default `create-tauri-app` React+TS+Vite scaffold:
- Tauri v2, React 19, Vite 7, TS 5.8 (strict, `noUnusedLocals`/`noUnusedParameters`).
- Default `greet` command in `src-tauri/src/lib.rs`; default `src/App.tsx`.
- Tauri's stock bundle icons in `src-tauri/icons/`; approved favicon assets (`icons8-workspace-liquid-glass-*`) in `public/icons/`.
- **Not yet installed:** Tailwind v4, shadcn/ui, sqlx, keyring, reqwest, TanStack Query, gooey/goey-toast.

## 3. Resolved decisions

| Decision | Resolution |
|---|---|
| Spec scope | M0 only; later milestones each get their own spec → plan → build. |
| App shell | **Minimal** — Home + Settings only. No sidebar/nav/command palette (M1+). |
| Routing | **No router lib in M0.** Simple `Home ↔ Settings` view switch (gear affordance on Home). `react-router` arrives with M1's sidebar. |
| DB schema in M0 | **`settings` table only.** Genuinely used to cache the Linear viewer identity. Other tables grow per milestone. |
| Server state | **TanStack Query included now.** "Test connection" uses `useMutation`. |
| Rust GraphQL client | `reqwest` + hand-written JSON bodies (no codegen for one query). |
| Secret storage | `keyring` crate behind a `SecretStore` trait; native backend selected per-OS (macOS Keychain / Windows Credential Manager / Linux Secret Service). Cross-platform. |
| App icon | Regenerate `src-tauri/icons/` from `public/icons/icons8-workspace-liquid-glass-310.png` via `tauri icon`. |
| Favicon | Wire `public/icons/icons8-workspace-liquid-glass-32.png` / `-96.png` in `index.html`; fix title to "Astryn". |
| Linear auth header | Raw personal API key in `Authorization`, **no `Bearer`** prefix (confirmed against live Linear docs). |

## 4. Architecture

### 4.1 Frontend
- **Tailwind v4 (CSS-first):** `@import "tailwindcss"` + `@tailwindcss/vite` plugin; no `tailwind.config.js`. Dark-first Linear palette (near-black bg, low-chroma grays, single indigo/blue accent) defined as `@theme` tokens in `src/styles/index.css` so shadcn inherits them.
- **shadcn/ui:** Tailwind-v4-compatible CLI init. Pull only `button`, `input`, `card`, `label`.
- **Views (no router):** `App.tsx` holds a `view: "home" | "settings"` switch.
  - **Home:** live **dual clock** — Dhaka (`Asia/Dhaka`) + Germany (`Europe/Berlin`), each labeled with city/zone, ticking every second via `Intl.DateTimeFormat` (DST-aware; no hard-coded offset; no date lib). Plus a connection-status line driven by `ConnectionStatus`.
  - **Settings:** password input to paste the Linear key, "Save", "Test connection", "Clear key".
- **TanStack Query:** `QueryClientProvider` at the root. "Test connection" is a `useMutation` (imperative, depends on hidden keychain state — avoids stale-cache ambiguity). Connection status is read via a query that is invalidated on save/clear.
- **Toasts:** `goey-toast` — `<GooeyToaster />` mounted at root, `gooeyToast.success/error/promise` for settings feedback, stylesheet imported. (Package name/version pinned against npm at install; `requirements.md` wrote `gooey-toast`, live package appears to be `goey-toast` v0.5.0.)
- **Typed boundary:** hand-maintained TS wrappers + types in `src/lib/commands.ts` mirroring Rust command I/O (tiny surface; `tauri-specta` is a future option).

### 4.2 Backend (Rust) — module seams
Subset of `requirements.md` §10:
- `secrets/` — **`SecretStore` trait** (`get`/`set`/`delete`) with a `keyring`-crate impl. Storage only. A fake impl backs Rust tests.
- `linear/` — **`LinearCredentialProvider`** (supplies authorization credentials to the client; the personal-key/OAuth seam from `requirements.md:100`) + **`LinearClient`** (`reqwest`-based GraphQL). M0 implements only `viewer`.
- `db/` — `sqlx` SQLite pool against `~/Documents/astryn/astryn.db` (resolved via Tauri's `document_dir()` + `astryn/`); embedded `sqlx::migrate!` run on startup; minimal `settings` repository (get/set the cached identity).
- `commands/` — thin Tauri handlers (replace `greet`), registered in `src-tauri/src/lib.rs`.

### 4.3 Data flow
`Settings UI → set_linear_key (IPC) → SecretStore` (key stored, never returned).
`Test connection → test_linear_connection → LinearCredentialProvider → LinearClient.viewer() → on success: persist name to settings table → return ConnectionStatus{connected,name}`.
`Home → get_connection_status → reads cached identity from settings (no network)`.

## 5. Secret-handling guarantee (enforceable)

The key transits the webview once because the user pastes it. The enforced rules:
- Sent **once** through Tauri IPC.
- **Never returned to TypeScript** by any command.
- **Never persisted** in browser storage, SQLite, logs, error payloads, or query caches.
- Password input + React state holding the key are **cleared immediately** after submit.
- Keychain identifiers: service `com.orion.astryn`, account `linear_api_key`.

## 6. ConnectionStatus model

Shared across the boundary:
```ts
type ConnectionStatus =
  | { state: "not_configured" }   // no key in keychain
  | { state: "unverified" }       // key present, no successful viewer call yet
  | { state: "connected"; name: string };  // last viewer call succeeded
```
- A successful `viewer` call persists `name` (and id/email if useful) to the `settings` table — this is what genuinely exercises the DB pipeline in M0.
- **Replacing** the key → invalidate cached identity (status drops to `unverified` until re-tested).
- **Clearing** the key → remove both the keychain entry and the cached identity (status → `not_configured`).

## 7. Tauri command surface

| Command | Input | Output | Notes |
|---|---|---|---|
| `set_linear_key` | `{ key: string }` | `()` / sanitized error | Stores in keychain; never echoes key. |
| `clear_linear_key` | — | `()` | Removes keychain entry **and** cached identity. |
| `get_connection_status` | — | `ConnectionStatus` | Reads cache only; no network. |
| `test_linear_connection` | — | `ConnectionStatus` | Runs `viewer`; persists name on success. |

All commands return **sanitized** errors — never raw reqwest/keyring/GraphQL diagnostics.

## 8. Backend details (locked)

- Keyring (blocking) runs **outside** the async executor (`tauri::async_runtime::spawn_blocking` or equivalent).
- `reqwest`: JSON, explicit connect/request **timeouts**, **rustls** TLS (portable builds, no OpenSSL dependency).
- Endpoint `https://api.linear.app/graphql`; header `Authorization: <raw key>` (no `Bearer`).
- **GraphQL errors are failures even on HTTP 200** — inspect the response `errors` array and map to a sanitized error.
- SQLite: create the `~/Documents/astryn/` directory if missing; open with `create_if_missing(true)`; **fail startup loudly** (clear error) if directory creation or migrations fail.

## 9. Icons

- **App/bundle icon:** `npm run tauri icon public/icons/icons8-workspace-liquid-glass-310.png` to regenerate `src-tauri/icons/`. (310px is below the ideal 1024px → icon may be slightly soft; a 1024px source can swap in later.)
- **Favicon + title:** point `index.html` at the 32px/96px file; change title `Tauri + React…` → `Astryn`.
- Bump default window 800×600 → ~1280×800.

## 10. Testing (Rust)

`cargo test` covers:
- **Migration execution** — migrations apply cleanly to a fresh DB (via a nested path so `create_dir_all` is exercised); `settings` table exists.
- **GraphQL error parsing** — an HTTP-200 body containing an `errors` array is treated as failure; sanitized message produced.
- **HTTP status interpretation** — `interpret_response` maps 401/403 → auth, 429 → rate-limited, 5xx → server, and 200 (valid / errors / malformed) correctly, so transport failures are never misclassified as "malformed".
- **Command behavior** — `set`/`get`/`clear` and status transitions, using a **fake `SecretStore`** (the trait's reason for existing). No real keychain in tests.
- **Connection-test logic** — via an injected viewer-fetcher: success persists the viewer name; failure leaves the cached identity unchanged; no-key returns `NotConfigured`.

(No JS test framework in M0; add one with the first frontend logic that warrants it.)

## 11. Definition of done

1. `npm run tauri dev` launches; Home shows both clocks ticking with the correct offset (Dhaka = Berlin + 4h CEST / +5h CET).
2. Settings: a valid key → "Test connection" shows **your name** (`viewer` smoke test) via a success toast; an invalid key shows a sanitized error toast.
3. Key persists in the OS keychain across restarts; never in SQLite/logs/webview/commits.
4. SQLite DB file is created and the `settings` migration has run; viewer name is cached there on success.
5. **Replacing** a key resets the prior connected identity.
6. **Clearing** a key removes both the keychain entry and the cached identity.
7. **Restarting offline** shows the cached identity without contacting Linear.
8. Invalid GraphQL responses and HTTP failures produce **sanitized** error toasts.
9. Rust tests (migration execution, GraphQL-error parsing, HTTP-status interpretation, command behavior via fake `SecretStore`, connection-test logic via injected fetcher) pass.
10. App builds (`npm run tauri build`) with the Astryn favicon + title + regenerated app icon.

## 12. Out of scope for M0

Issue sync, calendar, drawer, sidebar/nav, command palette, light theme, GitHub, `react-router`, any issue/label/relation/comment/activity/doc_links/github_prs/sync_cursors tables. (All M1+.)

## 13. To verify at build time

- Exact npm package name + current version + API for the toast library (`goey-toast` vs `gooey-toast`).
- Live Linear GraphQL `viewer` field shape via introspection.
- shadcn CLI's current Tailwind-v4 init flow.
