# Backlog

Features noted for upcoming work. Each entry: what the owner asked for, how it fits today's code, and the questions to settle before building.

## 1. Local folder as a documentation source

*Noted 2026-10-27.*

**Ask:** documentation can be added from a local folder containing Markdown, plain-text, or PDF files.

**Fit today:**

- Docs sources are GitHub repositories only (`docs_sources` / `docs_files` / `docs_sync_meta`, `src-tauri/src/commands/docs.rs`, `src/features/docs/`).
- In the module system, the `docs` feature requires the `docs-source` capability, which only `github` provides today. A local-folder source would be a second `docs-source` provider, so Docs could work with GitHub turned off.
- Reading files from disk must happen in Rust (no direct webview file access). Picking a folder needs Tauri's dialog plugin and a capability change, which is security-sensitive per `AGENTS.md`.

**Decisions (owner, 2026-10-27):**

1. **A source type inside Docs**, not a separate module. Docs sources become "GitHub repository" or "Local folder".
2. **Read in place.** Files are read from disk when viewed; nothing is copied into SQLite.
3. **On-demand refresh.** The folder tree is rescanned when the user asks (refresh action); no file watching.
4. **PDFs render as real pages** in the app.
5. **`.txt` shows as plain text** (not parsed as Markdown).
6. **Subfolders included recursively.** Anything that can't be read (unsupported type, unreadable or broken file, permission error) is skipped silently.

**Consequences to handle in the spec:**

- The module manifest currently says `docs` requires `docs-source`, which only GitHub provides. With local folders, Docs must work with GitHub off: drop that requirement (GitHub repositories then show as unavailable while GitHub is off, and local folders keep working).
- Only the folder path is stored (in `docs_sources`); `remove_module_data` for `docs` deletes the source entries, never the user's files.
- Rendering PDFs needs a viewer in the webview (e.g. pdf.js, already-cached bytes passed from Rust); confirm dependency and size limits when planning.

## 2. Turn individual screens on and off (e.g. Inbox)

*Noted 2026-10-27.* *Built 2026-10-28; see `docs/superpowers/specs/2026-10-28-screen-toggles-design.md`.*

**Ask:** be able to switch features off one by one, e.g. turn the Inbox off. The owner did not find an "off" control for it.

**Fit today:**

- Settings → Modules (the first Settings section) has on/off switches, but only per module: Linear, GitHub, Slack, AI, Docs, Reports, Link previews.
- Inbox, Calendar, Issues, This Week and Dependencies all belong to the Linear module (`VIEW_META` in `src/lib/modules.ts`), so today they can only be turned off together by turning Linear off. Module spec 1 explicitly left per-view toggles out of scope.
- Inbox is also the only user of the `notifications` capability, and the Dashboard reads it (Inbox KPI card, Communication panel).

**Decisions (owner, 2026-10-27):**

1. **Every screen is switchable except Dashboard and Calendar**, which always stay on (Calendar still disappears if its module, Linear, is off). Settings also stays on, since it's where the switches live.
2. **The switches live in Settings.** Proposed: nested under each module in Settings → Modules (e.g. Linear → Issues, This Week, Dependencies, Inbox). Confirm the exact placement when designing.
3. **Turning a screen off hides it and stops its work:** it leaves the dock, tabs, command palette and Dashboard, and its data fetching/polling stops (e.g. no notification polling while Inbox is off).
4. **The first-run picker offers screen choices too**, not only modules.

**Consequences to handle in the spec:**

- Screens that map 1:1 to a module (Pull Requests → GitHub, Slack → Slack, Docs, Reports) are already covered by the module switch; the per-screen switches matter mainly for Linear's screens (Issues, This Week, Dependencies, Inbox). Decide whether 1:1 screens get a duplicate switch or just reuse the module's.
- Screen state is a second layer on top of module state (a screen is shown only if its module is active **and** the screen is on). Store it alongside `modules_enabled` (e.g. a `screens_disabled` setting) so Rust can also skip work for a disabled screen, e.g. `list_notifications` when Inbox is off.
- Dashboard cards fed by a disabled screen (Inbox KPI and Communication panel) disappear, like they do for disabled modules.

## 3. Local tasks (a tracker that doesn't need Linear)

*Noted 2026-10-27.*

**Ask:** manage tasks locally instead of connecting to Linear. The UI should take the best ideas from ClickUp and Jira, look closer to ClickUp, but be less cluttered.

**Fit today:**

- This is the "swappable tracker" work planned as module **spec 3**. A new provider module (e.g. `local-tasks`) would provide the `tracker` capability, so Calendar, This Week, Dependencies, Reports and the Dashboard work without Linear.
- Today those screens and the issue drawer are built directly on Linear's data types (`CalendarIssue`, `IssueListItem`, `Relation`, Linear workflow states). Spec 3 has to put them on a tracker-neutral task model first; local tasks then become its first non-Linear implementation.
- Unlike Linear's cache, local tasks are the **source of truth** in SQLite. Losing the database means losing data, so backup/export matters, and `remove_module_data` must warn much more strongly than for cached modules.
- Design direction: an original, calm, dense UI in Astryn's own style (`DESIGN.md`), taking inspiration from how those tools organize work, not copying either product's look.

**Decisions (owner, 2026-10-28):**

1. **Multiple sources at once.** Linear and local tasks can be on together (one combined Calendar / This Week / Dashboard). Documentation can come from several sources at once: **ClickUp Docs links**, a local folder of Markdown, and GitHub repositories with Markdown, text or PDF files (item 1). *ClickUp Docs means a new `clickup` provider module (API token in the keychain, Rust client) that provides the `docs-source` capability; treat it as its own small spec.*
2. **Non-Linear (local) tasks follow ClickUp's flow and structure.** Linear tasks keep Linear-familiar UX.
3. **Statuses are custom workflows** (user-defined per list/space).
4. **Organisation: spaces → lists first; projects later**, with tasks added to projects. **Sprints supported.**
5. **All views:** list, board, calendar, table, timeline/Gantt.
6. **Import from Linear** (copy Linear tasks into local tasks) and a **backup option**.
7. **Fields and features: start with the most commonly used ones**, e.g. title, Markdown description, status, priority, assignee (self), start/due dates, labels, subtasks, checklists, dependencies, comments, attachments, estimates. Confirm the exact list when specifying.

**Consequences to handle in the spec:**

- Prerequisite is module spec 3: move Calendar, This Week, Dependencies, the issue drawer, Reports and the Dashboard onto a tracker-neutral task model that can merge several trackers. This is the largest piece and should be its own spec.
- Local tasks then get their own spec: data model (spaces, lists, projects, sprints, custom status workflows) in new SQLite migrations, the views, Linear import (one-way copy; decide how re-imports and duplicates are handled), and backup/restore (format, location, schedule).
- Because local tasks are the only copy of the data, backup should ship with the first release, not after.
- "ClickUp flow" means structure and interaction patterns; the visuals follow Astryn's `DESIGN.md` and stay original.
