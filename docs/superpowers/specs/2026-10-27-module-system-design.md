# Astryn Module System (Spec 1: registry + enable/disable)

**Status:** Draft for owner review, 2026-10-27.
**Requirement:** `requirements.md` §3 *Module architecture*; `PRODUCT.md` (Positioning, Principle 2).

## 1. Summary

Every integration becomes a **module** the owner can turn on or off, and the app
is shaped so new providers (Bitbucket, Microsoft Teams, Jira) can be added later
as modules without touching unrelated screens. This spec covers the module
registry and enable/disable for all **current** integrations, enforced in Rust,
plus the frontend gating, a Settings → Modules section, and a first-run picker.

The work is phased:

| Spec | Scope |
|---|---|
| **1 (this)** | Registry, capabilities, enable/disable for Linear, GitHub, Slack, LLM, Docs, Reports, link previews |
| 2 | Provider-agnostic code-host and chat surfaces; first second provider (Bitbucket or Teams) |
| 3 | Swappable issue tracker (Linear → Jira); calendar/issues/agenda/graph/drawer on a tracker contract |

## 2. Goals and non-goals

**Goals**

- A module that is off is invisible (navigation, dock, tabs, command palette,
  dashboard, Settings) and does no work (no sync, no network, no cross-module
  data in joins).
- A disabled module keeps its keychain token and SQLite cache; re-enabling is
  instant. A separate explicit action removes its data.
- Feature modules declare the capabilities they need, so a future provider of
  the same capability satisfies them without code changes in the feature.
- Existing installs see no change after upgrading; fresh installs choose their
  modules on first run.

**Non-goals (Spec 1)**

- Building Bitbucket, Teams, or Jira.
- Making the PR workspace, Slack board, or tracker views provider-agnostic.
- Runtime-loaded or third-party plugins (modules are compiled in).
- Toggling individual tracker views (Calendar, This Week, Dependencies).
- Per-module notification preferences.

## 3. Module model

Two kinds of module plus an always-on core.

| Module | Kind | Provides | Requires | Owns |
|---|---|---|---|---|
| `linear` | provider | `tracker`, `notifications` | — | Calendar, Issues, This Week, Dependencies, Inbox, issue tabs/drawer, Settings → Linear |
| `github` | provider | `code-host`, `docs-source` | — | Pull Requests, Settings → GitHub |
| `slack` | provider | `chat` | — | Slack, Settings → Slack |
| `llm` | provider | `llm` | — | Settings → AI |
| `docs` | feature | — | `docs-source` | Docs, Settings → Documentation |
| `reports` | feature | — | `tracker`; optional `code-host`, `llm` | Reports |
| `link-previews` | feature | — | — | Link preview cards in the editor |

**Core (not modules):** Dashboard, Settings shell, command palette, Appearance,
Calendar preferences (workdays), split workspace.

**Rules**

- A module is **active** when it is enabled *and* available.
- A provider module is always available.
- A feature module is available when every required capability has at least
  one *enabled* provider. Enabled-but-unavailable modules stay hidden; Settings
  shows what is missing ("Needs a code host — turn on GitHub").
- Optional capabilities change only output (Reports without `code-host` omits
  PRs; without `llm` it shows the fact sheet only — today's no-endpoint path).
- Cross-module chips (Linear issue chips on PRs and Slack messages) appear only
  while a `tracker` provider is active.
- Future providers: `bitbucket` → `code-host`, `docs-source`; `teams` → `chat`;
  `jira` → `tracker`. Spec 1 defines only the capability names and this contract.

## 4. Rust design

### 4.1 Registry (`src-tauri/src/modules/mod.rs`, new)

- `enum ModuleId { Linear, Github, Slack, Llm, Docs, Reports, LinkPreviews }`
  serialized as the kebab-case ids above.
- `enum Capability { Tracker, Notifications, CodeHost, DocsSource, Chat, Llm }`.
- `struct ModuleSpec { id, kind, provides: &[Capability], requires: &[Capability], optional: &[Capability] }`
  and a `static MANIFEST: &[ModuleSpec]` matching §3.
- Pure functions (unit-tested): `is_available(id, &enabled)`,
  `missing_capabilities(id, &enabled) -> Vec<Capability>`,
  `has_capability(cap, &enabled) -> bool`.
- `struct ModuleState { enabled: BTreeSet<ModuleId>, onboarded: bool }` held in
  `AppState.modules: std::sync::RwLock<ModuleState>`.

### 4.2 Storage and upgrade

- Two keys in the existing `settings` table, via `db::save_setting` /
  `db::load_setting`: `modules_enabled` (JSON array of ids) and
  `modules_onboarded` (`"true"`/`"false"`). No new table or migration.
- Provider cache wipes delete keys by name, so these keys survive them.
- On startup (`lib.rs` setup, after `init_pool`):
  - `modules_enabled` present → load it (unknown ids dropped).
  - absent and the Linear viewer id is cached (`linear_viewer_id` setting) →
    **existing install**: all modules enabled, `onboarded = true`, persisted.
  - absent otherwise → **fresh install**: enabled empty, `onboarded = false`
    (frontend shows the picker).

### 4.3 Enforcement

- `AppState::require(&self, id: ModuleId) -> Result<(), CmdError>` fails with a
  new sanitized `CmdError::ModuleDisabled` ("That module is turned off.") when
  the module is not active.
- Every `#[tauri::command]` wrapper calls `require` for its owning module before
  any keychain, network, or DB work:
  - Linear commands (`commands/mod.rs`, incl. `list_notifications`) → `linear`
  - `commands/github.rs` → `github`
  - `commands/slack.rs` → `slack`
  - `commands/docs.rs` → `docs`
  - `commands/reports.rs` LLM config commands → `llm`; `generate_report` → `reports`
    (inside it, the LLM pass runs only when `llm` is active; otherwise it returns
    the fact sheet, as today with no endpoint configured)
  - `fetch_link_preview` → `link-previews`
- **Exempt:** module-management commands (§4.5) and each provider's
  credential-*status* command, so Settings can describe a disabled module.
- **Guard coverage test:** a Rust test parses the `generate_handler!` list in
  `lib.rs` and asserts every command is mapped to a module or listed in an
  explicit `CORE_COMMANDS` set, so new commands cannot skip the guard.

### 4.4 Cross-module data

- `db/github.rs` `list_prs` and `db/slack.rs` `message_rows` take
  `include_tracker: bool`; when false they skip the `LEFT JOIN issues` and
  return the Linear fields as null. Callers pass `has_capability(Tracker)`.
- `generators/facts.rs` `assemble` takes `include_code_host: bool` and omits
  `github_prs` when false.
- `extract_linear_identifier` moves from `github/prs.rs` to a shared
  `issue_ref` helper so `slack/` no longer imports `github/`.
- Disabling a provider bumps its existing generation counter
  (`workspace_generation`, `github_generation`, `slack_generation`,
  `llm_generation`) so in-flight syncs are discarded instead of written.

### 4.5 Commands (new)

- `list_modules() -> ModulesView { onboarded, modules: Vec<ModuleInfo> }` where
  `ModuleInfo { id, kind, enabled, available, missing: Vec<Capability> }`.
- `set_enabled_modules(ids: Vec<ModuleId>)` — validates ids, persists, updates
  state, bumps generations of providers being disabled, sets `onboarded = true`.
- `remove_module_data(id)` — only allowed while the module is disabled
  (`CmdError::InvalidInput` otherwise). Runs the module's existing wipe and
  deletes its keychain accounts:
  - `linear`: `wipe_workspace_cache` + `linear_api_key`
  - `github`: `wipe_github_cache` (already clears docs files) + `github_token` + `github_favorite_repos`
  - `slack`: `wipe_slack_cache` + `slack_user_token`, `slack_cookie_d`
  - `llm`: `llm_base_url`, `llm_model` settings + `llm_api_key`
  - `docs`: `docs_sources` rows (files/meta follow)
  - `reports`, `link-previews`: in-memory caches only; no-op otherwise

## 5. Frontend design

### 5.1 Registry (`src/lib/modules.ts`, new)

- `useModules()` — TanStack query over `list_modules`; `isActive(id)`,
  `hasCapability(cap)` helpers. `set_enabled_modules` / `remove_module_data`
  invalidate it.
- `VIEW_META: Record<ViewKind, { label, icon, module: ModuleId | "core" }>` is the
  single list of destinations. It replaces the duplicated enumerations in
  `Dock.tsx` (`NAV`, `META`), `PaneTabStrip.tsx` (`META`), the
  `CommandPalette.tsx` "Go to" list (which also gains the missing Slack, Docs,
  and Reports entries), `DashboardPage.tsx` `QuickActions`, and
  `settingsSection.ts` groups. `SplitLayout.tsx` keeps its render switch but
  renders nothing for an inactive view.

### 5.2 Gating

- Dock, tab strip "+", palette, dashboard quick actions, and Settings nav list
  only active modules' entries.
- When a module turns off, its open tabs are closed (`paneModel` helper
  `closeTabsWhere(view ∈ inactiveViews)`); they are not restored on re-enable.
  Fallback tab remains the Dashboard.
- `useSyncLoop` and the Cmd+R resync run only while `tracker` is active.
  `useGithubSync`, `useGithubContributionsSync`, `useSlackSync`, `useDocsSync`,
  and `useNotifications` add `isActive(...)` to their `enabled` condition.
- Dashboard: attention sources, KPI tiles, and cards for inactive modules are
  omitted; if nothing is active it shows a quiet empty state pointing to
  Settings → Modules.
- Linear chips render only when the row carries a Linear id (already the case;
  Rust returns null when the tracker is off).
- "Connect …" buttons deep-link to the provider's Settings section via the
  existing `requestSettingsSection` store.

### 5.3 Settings → Modules

- New first group "Modules" in `SETTINGS_GROUPS`; it is the default section.
- One row per module: name, one-line description, switch, and — when enabled
  but unavailable — the missing capability with the provider to turn on.
- When a module is off, a **Remove module data** action opens a confirmation
  naming exactly what is deleted (token, cached data); it calls
  `remove_module_data`.
- Provider sections (Linear, GitHub, Slack, AI, Documentation) appear only
  while their module is enabled.

### 5.4 First-run picker

- When `onboarded` is false, `AppShell` renders a single "Choose your tools"
  screen instead of the workspace.
- Two groups — Integrations (providers) and Features — each a checkbox with a
  one-line description; feature rows show live "Needs …" hints from the same
  availability rules.
- Keyboard-operable (native checkboxes, focus on first item, Enter on
  Continue). **Continue** calls `set_enabled_modules`; nothing is enabled until
  then. Copy notes that Settings → Modules changes it later.
- Follows `DESIGN.md` (matte surfaces, tokens, no decoration).

### 5.5 Errors

Queries for inactive modules never run, so `ModuleDisabled` appears only in a
race (module turned off mid-request). The query layer treats it as a silent
cancellation — no toast.

## 6. Testing

**Rust (`cargo test`)**

- Availability and missing-capability logic for each feature module.
- Upgrade decision: seeded DB with `linear_viewer_id` → all enabled + onboarded;
  empty DB → nothing enabled, not onboarded; unknown ids dropped on load.
- `require` rejects disabled and unavailable modules.
- `list_prs` / `message_rows` with `include_tracker = false` return null Linear
  fields; `assemble` without code host omits PRs.
- `remove_module_data` refuses an enabled module and removes keychain entries
  and cache for a disabled one (`FakeSecretStore`, temporary DB).
- Guard coverage over `generate_handler!`.

**Frontend (Vitest)**

- `VIEW_META` filtering for Dock, palette, Settings nav.
- Closing a disabled module's tabs; Dashboard fallback.
- Settings → Modules: toggle calls `set_enabled_modules`; unavailable hint;
  remove-data confirmation flow.
- Picker: submit payload, keyboard flow, availability hints.
- Sync hooks stay disabled for inactive modules.

## 7. Risks and fixes folded in

- **Guard drift** — mitigated by the guard coverage test (§4.3).
- **Known coupling gaps** fixed in place: shared issue-reference parser (§4.4);
  `clearGithubQueries` also clears `docs-*` queries; a Linear cache wipe
  invalidates `github-prs` and `slack-catchup` queries that carry Linear fields.
- **Upgrade regressions** — covered by the seeded-DB test (§6).

## 8. Delivery order

One branch; the app stays runnable after each step:

1. Rust `modules/` registry, storage, upgrade logic, `list_modules` /
   `set_enabled_modules` / `remove_module_data`.
2. Command guards, cross-module join flags, shared issue-ref helper, guard test.
3. Frontend `modules.ts` + `VIEW_META` consolidation and gating.
4. Settings → Modules.
5. First-run picker.
