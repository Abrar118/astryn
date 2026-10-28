# Bitbucket Code Host Implementation Plan

> **For agentic workers:** execute task by task, test first. Steps use checkbox syntax.

**Goal:** Add Bitbucket Cloud as a second `code-host` module and make the PR workspace
provider-neutral without changing GitHub behavior.

**Spec:** `docs/superpowers/specs/2026-10-28-bitbucket-code-host-design.md`

## Global constraints

- Migrations only in `0030`–`0034` (this plan uses `0030`).
- Keychain accounts `bitbucket_email`, `bitbucket_token`; never returned to TypeScript.
- Every owned command starts with `state.require(crate::modules::ModuleId::Bitbucket)?;`.
- Shared files (`modules/mod.rs`, `lib.rs`, `commands/mod.rs`, `src/lib/modules.ts`)
  get small, localized edits only.
- Do not touch dashboard, reports, calendar/agenda, Slack, or docs-source code.

## Review focus

1. A failed favorite repository fetch must not erase its cache or the Needs My Review scope.
2. A `next` pagination URL outside `https://api.bitbucket.org/2.0/` is rejected (credential never leaves the API host).
3. Credential change mid-sync → `WorkspaceChanged`, nothing written.
4. GitHub PR page, drawer, query keys, and commands behave exactly as before.

### Task 1: Provider-neutral Rust types and cache

- [ ] Move `ParsedPr`, `Reviewer`, `PrDetail*`, `PrDiff*`, `RepositoryCatalog`,
  `RepositoryName` into `src-tauri/src/code_host.rs`; re-export from `github::*`.
- [ ] Move `PrRow`, `SyncMeta`, scope cache functions into `db/code_host.rs` with
  `PrTables`; `db/github.rs` delegates. Existing GitHub tests stay green.

### Task 2: Module registration and migration

- [ ] Failing tests: `bitbucket` serializes kebab-case, provides `code-host`, is not
  enabled by the legacy upgrade, guard coverage lists its commands.
- [ ] Add `ModuleId::Bitbucket`, manifest entry, `LEGACY` upgrade set,
  `0030_bitbucket_prs.sql`.

### Task 3: Bitbucket client and parsers (fixtures)

- [ ] Tests then code for: status mapping, `next` validation, Basic auth header,
  PR page parsing, reviewers/decision, needs-review predicate, workspaces/catalog
  parsing, detail assembly, unified-diff splitting.

### Task 4: Commands

- [ ] Tests then code for set/clear credentials (wipe + generation bump), status,
  test connection, sync logic (scopes, failure isolation, needs-review withholding,
  generation abort), list, favorite validation, repositories, detail, diff.
- [ ] Register in `lib.rs`, `command_owner`, `CORE_COMMANDS` (status),
  `remove_module_data`, generation bump on disable.

### Task 5: Frontend

- [ ] `commands.ts` bindings + `ModuleId`; queries; `MODULE_MANIFEST`/`MODULE_COPY`;
  `VIEW_META` + `ViewKind` + `SplitLayout` for `bitbucket-prs`.
- [ ] `CodeHostContext` + GitHub/Bitbucket host configs; PR components read it.
- [ ] Settings → Bitbucket section.
- [ ] Tests: Bitbucket page scopes/connect prompt/no heatmap; drawer uses host hooks.

### Task 6: Verify

- [ ] `npx vitest run src/features/prs`, `npm test`, `npm run build`,
  `cargo test|clippy|fmt --check --manifest-path src-tauri/Cargo.toml`, `git diff --check`.
- [ ] Update `requirements.md` status lines for module spec 2a.
