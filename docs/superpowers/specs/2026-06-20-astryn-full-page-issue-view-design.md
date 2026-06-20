# Astryn Full-Page Issue View

## Goal

Let a user open an issue **full-page as a workspace tab** (not only in the side drawer), from two entry points: the issue **right-click context menu** and the **drawer header breadcrumb**. The full page reuses the drawer's issue-detail UI — one source of truth, two presentations.

## Context

The app is a browser-style tabbed workspace (`lib/tabs.tsx`): each tab holds one `view` (`calendar | list | settings`), rendered in `<main>` by `AppShell`. The issue detail is currently rendered **only** inside `IssueDrawer`, a `?issue=`-driven sliding overlay whose body is the `DrawerContent` component (~600 lines). There is no full-page issue view today.

## Approach (chosen)

Full-page issue = a new **`"issue"` tab view** carrying an `issueId`, rendered full-width in `<main>`. This matches the tab model (multiple issues in multiple tabs, switchable, persisted) and how Linear/browsers behave. Rejected alternatives: replacing the current tab's view (loses the original view), and a full-screen overlay (a modal, not a navigable page).

## Design

### 1. Tab model (`lib/tabs.tsx`)
- `ViewKind` gains `"issue"`. `Tab` becomes `{ id: string; view: ViewKind; issueId?: string }`.
- `openIssueTab(issueId: string)`: if a tab with that `issueId` exists, select it; otherwise create `{ id, view: "issue", issueId }` and activate it (no duplicate tabs per issue).
- `setActiveView(view)` clears `issueId` on the active tab (switching an issue tab to calendar/list/settings via the dock converts it to that view).
- Persistence (`load()`): a persisted `"issue"` tab is kept only if it has a non-empty `issueId`; otherwise it is dropped (and `addTab`'s default view stays `calendar`). The `VIEWS` validation list includes `"issue"`.

### 2. Shared detail view (the main refactor)
Extract the issue-detail body from `DrawerContent` into a reusable `IssueDetail({ id, result, mode, onClose? })`:
- `mode: "drawer" | "page"`.
- **Drawer:** `IssueDrawer`'s sliding `<aside>` renders `<IssueDetail mode="drawer" onClose={...} />` — header keeps the **Close** button and gains an **"Open in full page"** icon button.
- **Page:** a new `IssuePage({ issueId })` calls `useIssueDetail(issueId)` and renders `<IssueDetail mode="page" />` full-width in `<main>` — no sliding chrome, no Close button, no full-page button (it is already full-page).
- `mode` only toggles header chrome (Close + full-page button) and the outer container; the header breadcrumb, scrollable main column (title, description, sub-issues, relations rail, attachments, activity/comments), and the properties rail are **shared verbatim**. No duplication of the detail UI.
- The drawer's `onClose` (clears `?issue=`) is drawer-only; page mode does not use it.

### 3. AppShell
`<main>` switch gains: `active.view === "issue" && active.issueId && <IssuePage issueId={active.issueId} />`.

### 4. TabBar
Issue tabs render the issue **identifier** as the label (resolved from the cached issues list via `useIssues`; fallback `"Issue"`) with a generic issue icon, plus the existing hover ✕ close. The `META` map (keyed by `ViewKind`) handles `calendar/list/settings`; the `"issue"` case is handled separately (dynamic label from `issueId`).

### 5. Entry points (both call `openIssueTab(id)`)
- **Context menu** (`IssueContextMenu.tsx`): an **"Open in full page"** `Row` (with an expand icon, e.g. `Maximize2`) beside the existing "Open details" row → `openIssueTab(issue.id)` + `onClose()`.
- **Drawer header breadcrumb** (`IssueDrawer.tsx`): an **expand icon button** in the header's right-hand button group → `openIssueTab(id)` then close the drawer (`onClose()`).

### 6. Behavior
- Opening full page **closes the drawer** if open (mode switch).
- In-app issue links/mentions still open the **drawer** (even over a full-page issue) — unchanged from today; the drawer is an overlay above `<main>`.
- An issue tab that fails to load / whose issue was deleted shows the same not-found/loading state the drawer would (via `useIssueDetail`).

## Testing
- **Vitest (pure tab logic):** the `openIssueTab` reducer — creates a new tab for a fresh issue + activates it; selects the existing tab when the issue is already open (no duplicate); `setActiveView` clears `issueId`; persistence `load()` drops an `"issue"` tab missing `issueId` and keeps a valid one.
- **Component smoke:** `IssuePage` renders the detail for a given `issueId`; the context-menu "Open in full page" row and the drawer breadcrumb button invoke `openIssueTab`.
- Gates: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

## Out of scope (YAGNI)
- Deep-linking a full-page issue via URL (the workspace is tab-/localStorage-driven, not URL-routed for views; `?issue=` remains the drawer's mechanism). Issue tabs persist via the existing localStorage tab state.
- A drawer⇄page toggle from within the full page ("open in drawer"); reverse direction not requested.
- Splitting `IssueDetail` further into sub-components beyond what the drawer/page reuse requires.
