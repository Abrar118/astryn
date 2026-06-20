# Astryn — Sub-issue Parity + Label Create

Two issue-detail polish features bringing the drawer/full-page closer to Linear:

- **A. Sub-issue list parity** — sub-issue rows look and behave like the Issues-list rows (badges), with a funnel **display-options** popover (ordering, completed filter, display-property toggles).
- **B. Labels dropdown + create** — the rail Labels control becomes a search + suggestions + checklist dropdown that can also **create a new label** inline.

These are independent and can ship/review separately; one spec because both are "issue-detail Linear parity" and both reuse existing machinery.

## Context

`IssueDetail` (in `IssueDrawer.tsx`, shared by drawer + full page) renders sub-issues as a custom simple row (`StatusIcon` + title + `MetaPill`s) and the Labels rail as a plain checklist popover. The Issues list (`IssuesView.tsx`) already has rich rows (`IssueRow`/`MetaCluster`/`Pill`/`LabelPills`/`PriorityIcon`) and a display-options popover, and shares view types via `viewConfig.ts` (`DisplayProps`, `Ordering`, `Completed`, `DisplayKey`, `DEFAULT_DISPLAY`). Children of an issue are themselves workspace issues, so they already exist in the `useIssues({})` cache as full `IssueListItem`s (with labels, PR counts, etc.). No `labelCreate` exists in the Rust backend.

## Feature A — Sub-issue list parity

### A1. Extract shared row components
Move `IssueRow`, `MetaCluster`, `Pill`, `LabelPills`, `PriorityIcon` out of `IssuesView.tsx` into a new `src/features/issues/IssueRow.tsx` (exported). Consolidate the duplicate `StatusIcon` in `IssuesView.tsx` to the already-shared `issueGlyphs.tsx` (`StatusIcon`). `IssuesView` imports the extracted components — **no behavior change to the Issues list** (verified by its existing tests + build).

### A2. Extract the display-options popover
Move the funnel popover content (Ordering select, Completed-issues select, Display-property toggle chips) from `IssuesView.tsx` into a reusable `src/features/issues/DisplayOptions.tsx` exporting `DisplayOptions({ ordering, onOrdering, completed, onCompleted, display, onToggleDisplay })`. It operates purely on the `viewConfig.ts` types. `IssuesView` uses it (no behavior change).

### A3. Sub-issues reuse the row + display options
In `IssueDetail`'s sub-issues `DrawerSection`:
- Resolve each `live.children[i].id` → the cached `IssueListItem` from `useIssues({})` (keyed by id). Render the shared `IssueRow` for resolved children (full badges). For a child not in the cache (rare), fall back to a minimal row built from `DetailChild`.
- Per-issue-detail local display state: `ordering` (default `DEFAULT_CONFIG.ordering`), `completed` (default `"all"`), `display: DisplayProps` (default a sub-issue-appropriate subset of `DEFAULT_DISPLAY` — priority, status, labels, cycle, dueDate, estimate, assignee on; created/updated/id off). The funnel button opens `DisplayOptions`.
- Apply `completed` filter (hide `completed`/`canceled` children when `"active"`) and `ordering` sort (reuse IssuesView's `compareIssues`, which moves to `IssueRow.tsx` or a small `issueSort.ts`) to the resolved children before rendering.
- Clicking a sub-issue row opens it (existing `openIssue`); right-click opens the issue context menu (`openMenu`).

### A4. "Nested sub-issues" toggle — OUT OF SCOPE
Linear's display menu has a "Nested sub-issues" toggle, but the backend returns only **one level** of children (`DetailChild` has no grandchildren). Supporting it needs recursive fetching — omitted. The `DisplayOptions` popover ships **without** the Nested toggle; a one-line code comment notes why.

## Feature B — Labels dropdown + create

### B1. Backend `create_label`
Add a `labelCreate` (Linear `issueLabelCreate(input: { name, color, teamId })`) mutation: Rust client method + `#[tauri::command] create_label(name, team_id, color) -> LabelOut` + parse fn (+ test) + registration, mirroring the existing comment/reaction mutation pattern (authed-call, sanitized errors, `success:false` → error). TS binding `createLabel(name, teamId, color): Promise<Label>`.

### B2. Label dropdown UI
Rework the rail **Labels** popover into a Linear-style dropdown:
- A search input ("Change or add labels…") filtering the label list.
- A "Suggestions" section (optional: labels not yet applied, top few) — minimal; may just be the filtered list.
- A checklist: checkbox + color dot + name; toggling assigns/unassigns (existing `patch({ labelIds })`).
- When the search text matches no existing label, a **"Create label '<query>'"** row: calls `createLabel(query, issue.teamId, <auto-color>)`, then assigns the new label to the issue and invalidates the `labels` query. Auto-color: pick from a fixed Linear-like palette (cycle by existing label count, or first unused).
- Team scope: the new label is created in the **issue's team** (`d.teamId`).

## Cross-cutting / constraints
- All Linear calls in Rust; sanitized `CmdError`; `success:false`/GraphQL-errors are failures. `goey-toast` for feedback (create-label failure toasts; optimistic label assign already rolls back via `useUpdateIssue`).
- TS strict; reuse `viewConfig.ts` types; no duplicated row UI (single `IssueRow`).
- After `create_label`, upsert/refetch labels so the new label appears in the dropdown + the rail.

## Testing
- **Rust:** `parse_label_create` test (success + `success:false`).
- **Vitest (pure/extractable):** `compareIssues` ordering + the completed-filter helper for sub-issues; the auto-color picker (deterministic given existing labels). Component-level: the extracted `IssueRow` renders badges per `DisplayProps`; the label dropdown shows a "Create label" row when the query has no match and calls `createLabel`.
- Gates: `cargo test`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`. Drawer/Issues-list behavior unchanged by the extraction (existing tests stay green).

## Out of scope (YAGNI)
- "Nested sub-issues" (A4). SLA display property (no SLA data). Editing a label's name/color. Per-sub-issue grouping (the list has grouping; sub-issues just sort+filter).
