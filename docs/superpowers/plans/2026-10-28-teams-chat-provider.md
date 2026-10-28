# Teams Chat Provider — Implementation Plan

Spec: `docs/superpowers/specs/2026-10-28-teams-chat-provider-design.md`.
Branch `feat/teams`. Migrations limited to 0035–0039 (uses 0035). TDD: each
task starts with a failing test.

## Task 1 — Registry

- [x] `modules/mod.rs`: failing tests for `teams` manifest (provides `chat`,
      active iff enabled) and legacy upgrade excluding Teams (R11); add
      `ModuleId::Teams`, manifest entry, `POST_MODULE_ADDITIONS`.
- [x] `src/lib/modules.ts` + `commands.ts` `ModuleId`: `teams` manifest/copy;
      `CAPABILITY_PROVIDERS.chat` names both providers.

## Task 2 — `teams/` pure logic

- [x] `teams/oauth.rs`: device-code + token-response parsing, validation
      (fixtures from the identity-platform docs).
- [x] `teams/mod.rs`: `TeamsError`, Graph status mapping, chunked
      `KeychainTokenProvider`, `GraphClient` (thin I/O).
- [x] `teams/catchup.rs`: parse `/me`, chats page, messages page (doc fixtures),
      HTML → text, unread + mention rules, chat names, next-link guard.

## Task 3 — Storage

- [x] `migrations/0035_teams_catchup.sql`.
- [x] `db/teams.rs`: replace/wipe/identity/config/list (neutral row shape,
      tracker join flag); a contract test that Teams rows serialize with the
      same keys as Slack rows.

## Task 4 — Commands

- [x] `commands/teams.rs` `_logic` fns with injected fetchers: sign-in poll
      (account switch), clear, status, test, sync (all-or-nothing, generation
      guard), catchup reads, open link.
- [x] `AppState` fields (`teams_credentials`, `teams`, `teams_lock`,
      `teams_generation`, `teams_pending`), `CmdError` variants, `lib.rs`
      registration, `commands/modules.rs` (bump generation, remove data, lock).
- [x] Guard-coverage tests include `commands/teams.rs`.

## Task 5 — Provider-neutral chat UI

- [x] `features/chat/` (`ChatProvider`, `CatchupBoard`, `ChatRows`,
      `ChatReader`) with tests; Slack page and rows become adapters (existing
      Slack tests unchanged and green).

## Task 6 — Teams UI

- [x] Teams bindings in `commands.ts`; `queries.ts` hooks gated by
      `isActive("teams")`; `TeamsPage`; `paneModel`/`VIEW_META`/`SplitLayout`.
- [x] Settings → Teams device-code section + nav entry; tests.

## Task 7 — Docs and verification

- [x] `requirements.md` (implementation status, §4 Teams auth, §11 line).
- [x] `npm test`, `npm run build`, `cargo test`, `cargo clippy`,
      `cargo fmt -- --check`, `git diff --check`.
