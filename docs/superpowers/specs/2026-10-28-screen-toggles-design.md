# Screen Toggles and Module Follow-ups

**Status:** Decided for this run (owner approval waived), 2026-10-28.
**Requirement:** `requirements.md` §3 *Module architecture*; `docs/backlog.md` item 2;
follow-ups from the module system (`2026-10-27-module-system-design.md`).

## 1. Summary

Individual screens can be switched off, on top of the module switches. A screen
that is off disappears from the dock, tabs, command palette and Dashboard, and
its data work stops (no Inbox notification fetches while Inbox is off). The
same branch closes five module-system follow-ups: atomic module writes,
shortcuts that cannot reach hidden screens, a retry on the Modules settings
screen, no "Sync failed" toast when Linear has no key, and no blank KPI slot.

## 2. Screen model

| Screen | View id | Module | Switchable |
|---|---|---|---|
| Dashboard | `dashboard` | core | no (always on) |
| Settings | `settings` | core | no (holds the switches) |
| Calendar | `calendar` | linear | no (on whenever Linear is on) |
| Issues | `list` | linear | **yes** |
| This Week | `this-week` | linear | **yes** |
| Dependencies | `graph` | linear | **yes** |
| Inbox | `inbox` | linear | **yes** |
| Pull Requests, Slack, Docs, Reports | … | 1:1 with their module | no; the module switch covers them |

- A view is **shown** when its module is active **and** its screen is not
  disabled.
- Screen ids are the existing view ids. They are already stable (persisted in
  the workspace tab layout), so no mapping layer is needed.
- State is stored as the set of **disabled** screens, so a screen added later
  defaults to on and existing installs see no change.

## 3. Rust

- `modules/screens.rs` (new): `enum ScreenId { Issues = "list", ThisWeek =
  "this-week", Dependencies = "graph", Inbox = "inbox" }`, `load_disabled` /
  `save_disabled` over the existing `settings` table key `screens_disabled`
  (JSON array). Missing key → empty; unknown ids dropped; malformed JSON → empty
  (everything on). **No migration.**
- `AppState` gains `screens: RwLock<BTreeSet<ScreenId>>` (loaded at startup).
- `list_modules` / `set_enabled_modules` return `ModulesView` with a new
  `disabledScreens` field.
- `set_disabled_screens(screens)` (new, core like the other module-management
  commands): persists then swaps the in-memory set; returns `ModulesView`.
- `list_notifications` calls `state.require_screen(ScreenId::Inbox)?` right
  after its Linear guard and returns the existing sanitized `ModuleDisabled`
  error while Inbox is off, which the frontend already treats as a silent
  cancellation.
- Issues, This Week and Dependencies read the local cache through commands the
  Calendar, drawer, Dashboard and Reports also use, so Rust gates nothing for
  them; their work stops because their screens are never mounted.

### 3.1 Atomic module writes (follow-up)

`set_enabled_modules_logic` persisted the new set and then swapped the in-memory
state without serialization, so two overlapping calls could leave SQLite and
memory disagreeing (and compute the wrong "disabled" list). Every module or
screen write now holds one process-wide async mutex (`MODULES_WRITE` in
`commands/modules.rs`) across persist + swap. A static rather than an
`AppState` field keeps the shared `AppState`/`lib.rs` edits small while other
lanes change them.

## 4. Frontend

### 4.1 Registry (`src/lib/modules.ts`)

- `SWITCHABLE_SCREENS` lists the four screen views.
- `viewActive(view, isActive, disabledScreens = [])` and
  `visibleViews(isActive, disabledScreens = [])` add the screen layer;
  `useModules()` also returns `disabledScreens` and `isViewActive(view)`, plus
  `isError` / `refetch` for the retry.
- `useNotifications` is enabled only while Linear is active **and** Inbox is on.

### 4.2 Gating

- Dock, palette "Go to", Dashboard quick actions use the screen-aware list.
- Tabs of a screen that turns off close (same `closeTabsWhere` path as modules).
- **Shortcut/opener gate (follow-up):** the workspace's openers refuse hidden
  views: `addTab` / `addTabIn` fall back to the Dashboard, `setActiveView`
  ignores a hidden view, and the issue openers do nothing while the tracker is
  off. Every path (dock, palette, `⌘T`, tab-strip "+", Dashboard links) goes
  through these, so none can open a hidden screen.
- **Picker gate (follow-up):** `AppShell` renders the first-run picker *outside*
  the workspace, palette and issue-menu providers, so their global shortcuts
  (`⌘K`, `⌘T`, `⌘W`, `⌘R`, `C`) are not registered while it is shown.

### 4.3 Settings → Modules

- Under each enabled module, its switchable screens appear as indented rows
  with their own switch ("Screens" group). They are hidden while the module is
  off.
- **Retry (follow-up):** if `list_modules` fails, the section shows
  "Couldn't load modules." with a **Retry** button that refetches.

### 4.4 First-run picker

When Linear is checked, a "Linear screens" group lists Issues, This Week,
Dependencies and Inbox, all checked. **Continue** saves the screen choice
(`set_disabled_screens`) and then the modules (`set_enabled_modules`, which
marks the app onboarded and dismisses the picker).

### 4.5 Dashboard

- Inbox off → no Inbox KPI, no Inbox attention items; the Communication card
  drops its Inbox count and is shown only while Slack is on.
- Links that pointed at a switchable screen pick the first shown of a fallback
  list: Overdue KPI and Week card → This Week, Issues, Calendar; Linear source
  row → Issues, Calendar.
- **KPI row (follow-up):** at ≥900px the row has as many columns as visible
  tiles (max 4), so a hidden tile leaves no blank slot; at the two-column width
  an odd last tile spans the row.

### 4.6 Missing Linear key (follow-up)

`sync_issues` returns "No Linear key is configured." when no key is stored.
The background sync loop now ignores that error (no toast). A manual sync
(dock Refresh, `⌘R`, palette) shows an info toast pointing to Settings →
Linear instead of "Sync failed".

## 5. Testing

- Rust: screen state load/save (missing, unknown, malformed), `require_screen`,
  `set_disabled_screens` persists and swaps, concurrent module writes leave
  SQLite and memory equal, `list_modules` carries `disabledScreens`.
- Vitest: screen-aware `visibleViews`/`viewActive`; tab openers refuse hidden
  views; picker hides shortcuts; Settings nested switches + retry; picker
  screen group payload; Dashboard Inbox KPI/Communication gating and KPI column
  count; sync loop silent without a key, manual refresh hint.

## 6. Out of scope

- Per-screen switches for 1:1 screens (the module switch already covers them).
- Turning Calendar or Dashboard off.
- A dedicated `ScreenDisabled` error variant (reuse `ModuleDisabled`).
