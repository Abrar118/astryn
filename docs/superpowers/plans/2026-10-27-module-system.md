# Module System (Spec 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every current integration (Linear, GitHub, Slack, LLM, Docs, Reports, link previews) becomes a module the owner can turn on or off, enforced in Rust, with frontend gating, Settings → Modules, and a first-run picker.

**Architecture:** A static Rust manifest (`modules/`) declares each module's kind and provided/required capabilities; enabled state lives in SQLite `settings` and in `AppState.modules`. Every Tauri command calls `AppState::require(module)` first, and cross-module SQL joins take flags. The frontend reads `list_modules` through one TanStack query and derives every navigation surface from a single `VIEW_META` registry.

**Tech Stack:** Rust (Tauri 2, sqlx/SQLite, tokio, thiserror), React 19 + TypeScript (strict), TanStack Query 5, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-module-system-design.md`

## Global Constraints

- Module ids (serialized, kebab-case): `linear`, `github`, `slack`, `llm`, `docs`, `reports`, `link-previews`.
- Capability ids: `tracker`, `notifications`, `code-host`, `docs-source`, `chat`, `llm`.
- Manifest: linear provides tracker+notifications; github provides code-host+docs-source; slack provides chat; llm provides llm; docs requires docs-source; reports requires tracker, optional code-host+llm; link-previews requires nothing.
- Settings keys: `modules_enabled` (JSON array of ids), `modules_onboarded` (`"true"`/`"false"`). No migration.
- New error: `CmdError::ModuleDisabled` with message `"That module is turned off."`.
- Disabling keeps keychain tokens and cache; only `remove_module_data` deletes them, and only for a disabled module.
- All external calls stay in Rust; tokens never reach TypeScript (`AGENTS.md`).
- UI follows `DESIGN.md`: theme tokens only, no gradients/glass, keyboard-operable, WCAG AA.
- Commands: `cargo test --manifest-path src-tauri/Cargo.toml`, `cargo clippy --manifest-path src-tauri/Cargo.toml`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, `npx vitest run <file>`, `npm test`, `npm run build`.

## Review Focus

1. **A module is turned off while its sync is in flight** → the late result is discarded, not written (generation bump). Test in Task 3.
2. **The only provider of a required capability is turned off** (GitHub off while Docs is on) → Docs is hidden and its commands fail `ModuleDisabled`; turning GitHub back on restores Docs without re-enabling it. Tests in Tasks 1 and 4.
3. **Persisted `modules_enabled` is malformed or has unknown ids** → unknown ids dropped, malformed JSON treated as "all enabled, onboarded" for an existing install, never a startup crash. Test in Task 2.
4. **The active tab in either pane belongs to a module being turned off** → those tabs close, an emptied pane collapses, and the workspace falls back to a Dashboard tab. Test in Task 7.
5. **The picker is submitted with nothing selected** → allowed; the app shows Dashboard (quiet empty state pointing to Settings → Modules) and Settings only. Test in Task 9.

---

### Task 1: Rust module manifest and availability rules

**Files:**
- Create: `src-tauri/src/modules/mod.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod modules;`)

**Interfaces:**
- Produces:
  - `#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)] #[serde(rename_all = "kebab-case")] pub enum ModuleId { Linear, Github, Slack, Llm, Docs, Reports, LinkPreviews }` with `pub const ALL: [ModuleId; 7]`
  - `pub enum Capability { Tracker, Notifications, CodeHost, DocsSource, Chat, Llm }` (same derives, kebab-case)
  - `pub enum ModuleKind { Provider, Feature }` (serde lowercase)
  - `pub struct ModuleSpec { pub id: ModuleId, pub kind: ModuleKind, pub provides: &'static [Capability], pub requires: &'static [Capability], pub optional: &'static [Capability] }`
  - `pub fn spec(id: ModuleId) -> &'static ModuleSpec`
  - `pub fn has_capability(cap: Capability, enabled: &BTreeSet<ModuleId>) -> bool`
  - `pub fn missing_capabilities(id: ModuleId, enabled: &BTreeSet<ModuleId>) -> Vec<Capability>`
  - `pub fn is_active(id: ModuleId, enabled: &BTreeSet<ModuleId>) -> bool` (enabled and nothing missing)
  - `#[derive(Clone, Debug, PartialEq)] pub struct ModuleState { pub enabled: BTreeSet<ModuleId>, pub onboarded: bool }`

- [ ] **Step 1: Write failing tests** in `modules/mod.rs` `#[cfg(test)]`:

```rust
#[test] fn docs_needs_a_docs_source() {
    let on = set(&[ModuleId::Docs]);
    assert_eq!(missing_capabilities(ModuleId::Docs, &on), vec![Capability::DocsSource]);
    assert!(!is_active(ModuleId::Docs, &on));
    assert!(is_active(ModuleId::Docs, &set(&[ModuleId::Docs, ModuleId::Github])));
}
#[test] fn reports_optional_capabilities_do_not_block() {
    assert!(is_active(ModuleId::Reports, &set(&[ModuleId::Reports, ModuleId::Linear])));
    assert!(!is_active(ModuleId::Reports, &set(&[ModuleId::Reports, ModuleId::Github, ModuleId::Llm])));
}
#[test] fn providers_are_active_iff_enabled() {
    assert!(is_active(ModuleId::Slack, &set(&[ModuleId::Slack])));
    assert!(!is_active(ModuleId::Slack, &set(&[])));
}
#[test] fn ids_serialize_kebab_case() {
    assert_eq!(serde_json::to_string(&ModuleId::LinkPreviews).unwrap(), "\"link-previews\"");
    assert_eq!(serde_json::to_string(&Capability::CodeHost).unwrap(), "\"code-host\"");
}
```

- [ ] **Step 2: Run** `cargo test --manifest-path src-tauri/Cargo.toml modules::` → FAIL (module missing).
- [ ] **Step 3: Implement** the types, `MANIFEST` (Global Constraints table), and the four functions. `has_capability` = any enabled *provider* whose `provides` contains the cap.
- [ ] **Step 4: Run** the same command → PASS; `cargo clippy` clean.
- [ ] **Step 5: Commit** `feat(modules): add module manifest and availability rules`.

---

### Task 2: Persisted module state, upgrade rule, and `require`

**Files:**
- Modify: `src-tauri/src/modules/mod.rs` (storage fns + tests)
- Modify: `src-tauri/src/commands/mod.rs` (`AppState.modules`, `CmdError::ModuleDisabled`, `impl AppState { pub fn require }`)
- Modify: `src-tauri/src/lib.rs` (load state in `setup`, after `recover_pending_deletes`)

**Interfaces:**
- Consumes: Task 1 types; `db::save_setting`, `db::load_setting` (`db/mod.rs:33,47`; drop their `#[allow(dead_code)]`).
- Produces:
  - `pub async fn load_state(pool: &SqlitePool) -> Result<ModuleState, sqlx::Error>`
  - `pub async fn save_state(pool: &SqlitePool, state: &ModuleState) -> Result<(), sqlx::Error>`
  - `AppState.modules: std::sync::RwLock<ModuleState>`
  - `impl AppState { pub fn require(&self, id: ModuleId) -> Result<(), CmdError> }` and `pub fn module_active(&self, id) -> bool`, `pub fn capability(&self, cap) -> bool`

- [ ] **Step 1: Write failing tests** (temp DB via the `pool()` helper pattern in `db/github.rs:269`):

```rust
#[tokio::test] async fn fresh_install_starts_empty_and_not_onboarded() {
    let (_d, pool) = pool().await;
    let s = load_state(&pool).await.unwrap();
    assert!(s.enabled.is_empty()); assert!(!s.onboarded);
}
#[tokio::test] async fn existing_install_enables_everything_once() {
    let (_d, pool) = pool().await;
    db::save_setting(&pool, "linear_viewer_id", "u1").await.unwrap();
    let s = load_state(&pool).await.unwrap();
    assert_eq!(s.enabled.len(), ModuleId::ALL.len()); assert!(s.onboarded);
    assert_eq!(db::load_setting(&pool, "modules_onboarded").await.unwrap().as_deref(), Some("true"));
}
#[tokio::test] async fn unknown_ids_are_dropped_and_bad_json_falls_back() {
    let (_d, pool) = pool().await;
    db::save_setting(&pool, "modules_enabled", r#"["slack","teams"]"#).await.unwrap();
    db::save_setting(&pool, "modules_onboarded", "true").await.unwrap();
    assert_eq!(load_state(&pool).await.unwrap().enabled, set(&[ModuleId::Slack]));
    db::save_setting(&pool, "modules_enabled", "{nope").await.unwrap();
    assert_eq!(load_state(&pool).await.unwrap().enabled.len(), ModuleId::ALL.len());
}
#[tokio::test] async fn save_then_load_round_trips() { /* save {Linear, Docs}, onboarded=true → load equals */ }
```

Plus in `commands/mod.rs` tests: `require` returns `Err(CmdError::ModuleDisabled)` for a disabled provider and for an enabled-but-unavailable feature, `Ok` for an active one (build the state with a helper that only fills `modules`; if `AppState` is too heavy to construct in tests, put the check in a free fn `require_in(&ModuleState, ModuleId)` and have `AppState::require` delegate to it, and test that).

- [ ] **Step 2: Run** `cargo test --manifest-path src-tauri/Cargo.toml modules::` → FAIL.
- [ ] **Step 3: Implement.** Upgrade rule: key absent → existing install iff `linear_viewer_id` is set (enable all, onboarded, persist); else empty + not onboarded (do not persist). Malformed JSON → enable all, onboarded. Add `ModuleDisabled` with `#[error("That module is turned off.")]`. `setup` loads the state with `block_on(modules::load_state(&pool))` and `.expect("failed to load module state")`.
- [ ] **Step 4: Run** tests → PASS; `cargo build` passes.
- [ ] **Step 5: Commit** `feat(modules): persist module state and add the require guard`.

---

### Task 3: Module management commands and TS bindings

**Files:**
- Create: `src-tauri/src/commands/modules.rs` (+ `pub mod modules;` in `commands/mod.rs`)
- Modify: `src-tauri/src/lib.rs` (register 3 commands)
- Modify: `src/lib/commands.ts` (types + bindings)

**Interfaces:**
- Consumes: Task 2 `load_state`/`save_state`, `AppState.modules`; wipes `db::issues::wipe_workspace_cache`, `db::github::wipe_github_cache`, `db::slack::wipe_slack_cache`; `SecretStore::delete`; keychain accounts from `lib.rs:19-23` and `commands/mod.rs:30` (`llm_api_key`).
- Produces (Rust): `#[derive(Serialize)] pub struct ModuleInfo { id, kind, enabled: bool, available: bool, missing: Vec<Capability> }`, `pub struct ModulesView { onboarded: bool, modules: Vec<ModuleInfo> }` (serde camelCase), logic fns `list_modules_logic(&ModuleState) -> ModulesView`, `set_enabled_modules_logic(pool, &RwLock<ModuleState>, ids: Vec<ModuleId>) -> Result<Vec<ModuleId> /* newly disabled */, CmdError>`, `remove_module_data_logic(pool, store, &ModuleState, id) -> Result<(), CmdError>`; commands `list_modules`, `set_enabled_modules(ids)`, `remove_module_data(id)`.
- Produces (TS): `type ModuleId`, `type Capability`, `type ModuleInfo = { id: ModuleId; kind: "provider" | "feature"; enabled: boolean; available: boolean; missing: Capability[] }`, `type ModulesView = { onboarded: boolean; modules: ModuleInfo[] }`, `listModules()`, `setEnabledModules(ids: ModuleId[])`, `removeModuleData(id: ModuleId)`.

- [ ] **Step 1: Write failing tests** in `commands/modules.rs`:
  - `list_reports_missing_tracker`: state {Reports} → Reports `available == false`, `missing == [Tracker]`.
  - `set_enabled_persists_and_marks_onboarded`: returns newly-disabled ids; `load_state` afterwards equals the new set with `onboarded == true`.
  - `remove_refuses_enabled_module`: `Err(CmdError::InvalidInput)`.
  - `remove_slack_wipes_cache_and_tokens`: with `FakeSecretStore` holding `slack_user_token`/`slack_cookie_d` and a seeded slack row, after removal both accounts are gone and `slack_messages` is empty; `linear_api_key` untouched.
  - `remove_llm_clears_settings_and_key`: `llm_base_url`, `llm_model` settings and `llm_api_key` gone.
- [ ] **Step 2: Run** `cargo test ... commands::modules` → FAIL.
- [ ] **Step 3: Implement.** The `set_enabled_modules` wrapper bumps the generation counter of every newly disabled provider (`linear`→`workspace_generation`, `github`→`github_generation`, `slack`→`slack_generation`, `llm`→`llm_generation`) with `fetch_add(1, SeqCst)`, under that provider's lock, so in-flight syncs drop their write (Review Focus 1). `remove_module_data` per spec §4.5; `docs` deletes `docs_sources`, `docs_files`, `docs_sync_meta` rows; `reports`/`link-previews` clear in-memory state only.
- [ ] **Step 4: Add a generation test** `disabling_github_bumps_generation`: call `set_enabled_modules_logic` removing GitHub and assert the returned list contains `Github` (the wrapper's bump is a one-liner over that list).
- [ ] **Step 5: Run** tests → PASS; add TS bindings; `npx tsc --noEmit` passes.
- [ ] **Step 6: Commit** `feat(modules): add list/set/remove module commands`.

---

### Task 4: Guard every command and test coverage

**Files:**
- Modify: `src-tauri/src/commands/mod.rs`, `commands/github.rs`, `commands/slack.rs`, `commands/docs.rs`, `commands/reports.rs`
- Modify: `src-tauri/src/modules/mod.rs` (`pub fn command_owner(name: &str) -> Option<ModuleId>`, `pub const CORE_COMMANDS: &[&str]`)

**Interfaces:**
- Consumes: `AppState::require` (Task 2).
- Produces: the guard map used by the coverage test.

- [ ] **Step 1: Write the failing coverage test** in `modules/mod.rs`:

```rust
#[test] fn every_registered_command_has_an_owner_or_is_core() {
    let src = include_str!("../lib.rs");
    let list = src.split("generate_handler![").nth(1).unwrap().split("])").next().unwrap();
    for name in list.split(',').map(|s| s.trim().rsplit("::").next().unwrap()).filter(|s| !s.is_empty()) {
        assert!(command_owner(name).is_some() || CORE_COMMANDS.contains(&name), "unguarded command: {name}");
    }
}
```

`CORE_COMMANDS` = the three Task 3 commands plus each provider's status command (`get_connection_status`, `get_github_status`, `get_slack_status`, `get_llm_config`) and `get_docs_status` if present.

- [ ] **Step 2: Run** → FAIL listing unguarded commands.
- [ ] **Step 3: Implement** `command_owner` by command group (spec §4.3: Linear group incl. `list_notifications` → `Linear`; `commands/github.rs` → `Github`; `commands/slack.rs` → `Slack`; `commands/docs.rs` → `Docs`; LLM config set/clear/test → `Llm`; `generate_report` → `Reports`; `fetch_link_preview` → `LinkPreviews`). Add `state.require(ModuleId::X)?;` as the first line of every owned `#[tauri::command]` wrapper. In `generate_report`, run the LLM pass only if `state.module_active(ModuleId::Llm)`; otherwise return the fact sheet (existing no-endpoint path).
- [ ] **Step 4: Add a behavior test** for Review Focus 2: with state {Docs} (GitHub off), `require(ModuleId::Docs)` is `Err(ModuleDisabled)`; after enabling GitHub it is `Ok` without touching Docs' flag.
- [ ] **Step 5: Run** `cargo test`, `cargo clippy`, `cargo fmt -- --check` → all pass.
- [ ] **Step 6: Commit** `feat(modules): guard every command by its owning module`.

---

### Task 5: Cross-module data flags and shared issue-reference parser

**Files:**
- Create: `src-tauri/src/issue_ref.rs` (move `extract_linear_identifier` from `github/prs.rs:88`; re-export or update callers in `github/prs.rs`, `github/pr_detail.rs:359`, `slack/catchup.rs:251`)
- Modify: `src-tauri/src/db/github.rs:234` `list_prs(pool, include_tracker: bool)`
- Modify: `src-tauri/src/db/slack.rs` `list_mentions(pool, include_tracker)`, `list_conversation_messages(pool, id, include_tracker)`, `message_rows(..., include_tracker)`
- Modify: `src-tauri/src/generators/facts.rs:79` `assemble(pool, viewer_id, viewer_name, window, include_code_host: bool)`
- Modify callers: `commands/github.rs:856` (`list_github_prs_logic(pool, include_tracker)`), `commands/slack.rs` catch-up logic, `commands/reports.rs:208`

**Interfaces:**
- Consumes: `AppState::capability(Capability::Tracker | CodeHost)` (Task 2) at the command wrappers.
- Produces: the signatures above.

- [ ] **Step 1: Write failing tests:**
  - `db/github.rs`: `list_prs_without_tracker_has_no_linear_fields` — seed an issue `ENG-1` and a PR with `linear_identifier = "ENG-1"`; `list_prs(&pool, false)` row has `linear_issue_id == None` and no state fields; `list_prs(&pool, true)` still resolves it.
  - `db/slack.rs`: same pattern for `list_mentions(&pool, false)` → `linear_issue_id == None`, `linear_identifier` still present (raw text stays).
  - `generators/facts.rs`: `assemble(..., false)` → `merged_prs` and `open_prs` empty with PR rows seeded.
- [ ] **Step 2: Run** → FAIL (signature mismatch).
- [ ] **Step 3: Implement.** When the flag is false, select `NULL AS linear_issue_id` (and null Linear state columns) without the `LEFT JOIN issues`; `assemble` skips both PR queries. Update existing test call sites to pass `true`.
- [ ] **Step 4: Run** `cargo test` → PASS; `rg -n "github::prs::extract_linear_identifier" src-tauri/src/slack` → no hits.
- [ ] **Step 5: Commit** `refactor(modules): gate cross-module joins and share the issue-ref parser`.

---

### Task 6: Frontend module registry and single view registry

**Files:**
- Create: `src/lib/modules.ts`, `src/lib/modules.test.ts`
- Modify: `src/components/Dock.tsx` (drop `NAV`/`META`), `src/components/PaneTabStrip.tsx` (drop `META`), `src/features/command/CommandPalette.tsx` ("Go to" list), `src/features/dashboard/DashboardPage.tsx` (`QuickActions`), `src/features/settings/settingsSection.ts` + `SettingsNav.tsx`

**Interfaces:**
- Consumes: Task 3 TS bindings.
- Produces:
  - `useModules(): { data?: ModulesView; isActive(id: ModuleId): boolean; hasCapability(cap: Capability): boolean; ready: boolean }` (query key `["modules"]`)
  - `export const VIEW_META: Record<Exclude<ViewKind, "issue">, { label: string; icon: LucideIcon; module: ModuleId | "core" }>` — labels as today (`Dock.tsx:52`); owners: dashboard/settings → `core`; calendar/list/this-week/graph/inbox → `linear`; prs → `github`; slack → `slack`; docs → `docs`; reports → `reports`.
  - `export function visibleViews(isActive: (id: ModuleId) => boolean): Exclude<ViewKind, "issue">[]` (VIEW_META order)
  - `export function viewActive(view: ViewKind, isActive): boolean` (`issue` → `isActive("linear")`)
  - `SettingsSection` gains `"modules"`; `SettingsGroup.items[].module: ModuleId | "core"`; linear/github/slack/ai/documentation map to linear/github/slack/llm/docs.

- [ ] **Step 1: Write failing tests** (`modules.test.ts`):

```ts
it("hides views of inactive modules but keeps core", () => {
  const active = (id: ModuleId) => id === "github";
  expect(visibleViews(active)).toEqual(["dashboard", "prs", "settings"]);
});
it("issue tabs follow the tracker", () => {
  expect(viewActive("issue", () => false)).toBe(false);
  expect(viewActive("issue", (id) => id === "linear")).toBe(true);
});
```

Plus a `CommandPalette.test.tsx` case: with only `slack` active, "Go to" lists Dashboard, Slack, Settings — and Slack/Docs/Reports entries exist when their modules are active.
- [ ] **Step 2: Run** `npx vitest run src/lib/modules.test.ts src/features/command` → FAIL.
- [ ] **Step 3: Implement** `modules.ts`; replace each enumeration with `VIEW_META` + `visibleViews`. Settings nav filters items whose `module` is inactive. While `useModules` is loading, render core entries only.
- [ ] **Step 4: Run** the tests, then `npm test` and `npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** `feat(modules): derive navigation from one view registry`.

---

### Task 7: Runtime gating (tabs, sync, dashboard, query hygiene)

**Files:**
- Modify: `src/lib/paneModel.ts` (+ `paneModel.test.ts`), `src/lib/tabs.tsx`
- Modify: `src/lib/queries.ts` (`useSyncLoop`, `useGithubSync`, `useGithubContributionsSync`, `useSlackSync`, `useDocsSync`, `useNotifications`, `clearGithubQueries`, `clearWorkspaceQueries`)
- Modify: `src/components/AppShell.tsx`, `src/features/command/CommandPalette.tsx` (Cmd+R), `src/features/dashboard/DashboardPage.tsx`, `src/features/dashboard/dashboard.ts`

**Interfaces:**
- Consumes: `useModules`, `viewActive` (Task 6).
- Produces: `export function closeTabsWhere(state: WorkspaceState, drop: (t: Tab) => boolean): WorkspaceState` in `paneModel.ts`.

- [ ] **Step 1: Write failing tests:**
  - `paneModel.test.ts` (Review Focus 4): split state, left pane `[calendar(active), prs]`, right pane `[slack]`; `closeTabsWhere(s, t => t.view === "slack" || t.view === "calendar")` → one pane `[prs]`, `assertInvariants` holds; dropping every tab → `FALLBACK` (Dashboard).
  - `dashboard.test.ts`: `buildDashboard` (or the current input-assembly fn) with `active = { linear: false }` produces no `linear`/`inbox` attention items and an empty-state flag when nothing is active.
  - `githubQueries.test.tsx`: `clearGithubQueries` removes `["docs-sync", …]` and `["docs-*"]` queries.
- [ ] **Step 2: Run** those files → FAIL.
- [ ] **Step 3: Implement:**
  - `tabs.tsx`: an effect on `useModules` data applies `closeTabsWhere(state, t => !viewActive(t.view, isActive))` once modules are loaded and whenever they change.
  - Sync hooks: AND `isActive(...)` into each `enabled`; `useSyncLoop` takes `enabled: boolean` and AppShell passes `hasCapability("tracker")`; Cmd+R is a no-op without a tracker.
  - Linear wipe path (`clearWorkspaceQueries`) also invalidates `["github-prs"]` and `["slack-catchup"]`.
  - Dashboard: skip attention sources/cards for inactive modules; when none of linear/github/slack is active render the quiet empty state ("No modules are on. Turn some on in Settings → Modules.") with a button calling `requestSettingsSection("modules")` + `setActiveView("settings")`.
  - Treat a rejection equal to `"That module is turned off."` as silent (no toast) where the query layer surfaces errors.
  - The "Connect …" buttons (`PrsPage.tsx:179`, `SlackPage.tsx:27`, `ReportsPage.tsx:143`) call `requestSettingsSection(<provider section>)` before `setActiveView("settings")`, as `DocsPage.tsx:136` already does.
- [ ] **Step 4: Run** the tests, `npm test`, `npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** `feat(modules): gate tabs, sync, and dashboard by module`.

---

### Task 8: Settings → Modules

**Files:**
- Create: `src/features/settings/sections/ModulesSection.tsx`, `ModulesSection.test.tsx`
- Modify: `src/features/settings/settingsSection.ts` (`"modules"` first, in a "Modules" group; `DEFAULT_SECTION` becomes `"modules"`), `src/features/settings/Settings.tsx`

**Interfaces:**
- Consumes: `useModules`, `setEnabledModules`, `removeModuleData`.
- Produces: `MODULE_COPY: Record<ModuleId, { name: string; description: string }>` (exported from `modules.ts`, reused by Task 9) and `CAPABILITY_PROVIDERS: Record<Capability, string>` copy (e.g. `"code-host": "a code host — turn on GitHub"`).

- [ ] **Step 1: Write failing tests** (`ModulesSection.test.tsx`, jsdom, mocked bindings):
  - toggling Slack off calls `setEnabledModules` with every other enabled id;
  - Docs enabled with GitHub off shows "Needs a code host" / docs-source hint text from `CAPABILITY_PROVIDERS`;
  - "Remove module data" is absent for enabled modules; for a disabled one it opens a confirmation listing what is deleted, and confirming calls `removeModuleData("slack")`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Native `<input type="checkbox" role="switch">` per row; confirmation uses the existing popover/modal pattern in `src/components/`; success/error via `gooeyToast`. Tokens only (`DESIGN.md`).
- [ ] **Step 4: Run** the file, `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(settings): add the Modules section`.

---

### Task 9: First-run module picker

**Files:**
- Create: `src/features/onboarding/ModulePicker.tsx`, `ModulePicker.test.tsx`
- Modify: `src/components/AppShell.tsx`

**Interfaces:**
- Consumes: `useModules`, `setEnabledModules`, `MODULE_COPY`, availability rules mirrored client-side: `export function previewMissing(id: ModuleId, selected: Set<ModuleId>): Capability[]` in `modules.ts` (same manifest as Rust; add a Vitest table test asserting it matches the Global Constraints manifest).

- [ ] **Step 1: Write failing tests:**
  - renders when `onboarded === false`; AppShell renders the picker instead of `SplitLayout`/`Dock`;
  - two groups "Integrations" (linear, github, slack, llm) and "Features" (docs, reports, link-previews);
  - checking Docs alone shows its "Needs …" hint; also checking GitHub clears it;
  - **Continue with nothing selected** calls `setEnabledModules([])` (Review Focus 5), after which the shell renders with Dashboard and Settings only;
  - first checkbox receives focus on mount; Enter on Continue submits.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the screen (heading "Choose your tools", one line saying it can be changed in Settings → Modules), invalidating `["modules"]` on success.
- [ ] **Step 4: Run** the file, `npm test`, `npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(modules): add the first-run module picker`.

---

### Task 10: Docs and full verification

**Files:**
- Modify: `requirements.md` (Implementation status + §11: module system Spec 1 shipped), `AGENTS.md` (module rule: new provider code must declare a `ModuleId`, guard its commands, and appear in `VIEW_META`)

- [ ] **Step 1: Update the two docs** with the facts above (no new requirements).
- [ ] **Step 2: Run** `cargo test`, `cargo clippy`, `cargo fmt -- --check` (all with `--manifest-path src-tauri/Cargo.toml`), `npm test`, `npm run build` → all pass.
- [ ] **Step 3: Manual check in `npm run tauri dev`:** fresh profile shows the picker; turning Slack off removes it from Dock, palette, dashboard and Settings and stops its poll; Remove module data then re-enable shows "Connect Slack".
- [ ] **Step 4: Commit** `docs: record the module system`.
