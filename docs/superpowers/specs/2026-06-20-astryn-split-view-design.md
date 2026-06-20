# Split-View (Two-Pane Workspace) — Design

**Milestone:** M1 (calendar + drawer + drag) — final feature
**Date:** 2026-06-20
**Status:** Approved (design)

## Goal

Add VSCode-style split-screen support to the tabbed workspace: the user can show
two tabs side by side, each pane an independent tab group with its own tab strip
and active tab. Four interactions drive it:

1. Right-click a tab → **Open in split view to the right**.
2. **Drag a tab into the right half** of the content area → opens it in a right split.
3. The split is **resizable** (draggable divider).
4. The two panes can be **swapped** (left ↔ right).

Plus a third way to fill the right pane by **picking a specific issue** (not an
existing tab): from the issue right-click menu and from the command palette.

## Scope & non-goals

- **Exactly two panes, side-by-side (horizontal).** No vertical splits, no 3+
  panes, no nested grids. The state is a pair, not a tree. (Extensible later.)
- **No new dependencies.** The divider is a small pointer handler, not
  `react-resizable-panels`.
- **No Rust / backend changes.** This is entirely frontend UI state.
- **Tab reordering within/between strips by drag is out of scope** (only the
  drag-to-split / move-to-other-pane drops below). The global `IssueDrawer`
  (`?issue=` overlay) stays a **full-window overlay**, not per-pane.

## Data model & state (`src/lib/tabs.tsx`)

The workspace moves from a flat tab list to **panes that own tabs** (max 2):

```ts
type Tab  = { id: string; view: ViewKind; issueId?: string };
type Pane = { id: string; tabs: Tab[]; activeTabId: string };
type Persisted = {
  panes: Pane[];          // length 1 (single) or 2 (split: [left, right])
  focusedPaneId: string;  // which pane the Dock / "+" / keyboard act on
  ratio: number;          // left-pane width fraction, clamped 0.2–0.8
  seq: number;            // monotonic id counter (unchanged role)
};
```

### Migration

`parsePersisted` accepts **both** the old shape `{ tabs, activeId, seq }` and the
new shape. An old blob becomes a single pane:
`{ panes: [{ id: "pane-0", tabs, activeTabId: activeId }], focusedPaneId: "pane-0", ratio: 0.5, seq }`.
Existing users' open tabs survive the upgrade. Malformed input falls back to the
same single-calendar-tab default as today.

### Pure reducers (unit-tested, mirroring today's `upsertIssueTab`)

All take state + args and return new state; no React, fully testable:

- `splitTabRight(state, tabId)` — move `tabId` out of its pane into a **new right
  pane**; if already split, move it into the existing right pane. **No-op when the
  tab is the only tab in the only pane** (splitting it would leave the left pane
  empty) — there must be something to keep on the left.
- `moveTabToOtherPane(state, tabId)` — move a tab from its current pane to the
  other existing pane (used when dropping onto the other pane's strip).
- `swapPanes(state)` — reverse `panes`, set `ratio = 1 - ratio`.
- `closeTabIn(state, tabId)` — remove a tab from its pane; if that empties a pane
  **and** there are 2 panes, drop the pane (the survivor becomes the sole,
  full-width pane). Never closes the last remaining tab of a single pane.
- `clampRatio(ratio, containerPx, minPanePx = 320)` — clamp so neither pane goes
  below `minPanePx`.
- `openIssueInRightSplit(state, issueId)` — ensure a right pane exists (split if
  single), open-or-focus the issue tab in the **right** pane (dedupe within it),
  focus the right pane.

### Context API (`useWorkspace`)

Keeps its current surface, all retargeted to the **focused pane** so existing
consumers (Dock, CommandPalette, IssueContextMenu, TabBar) keep working:

- existing: `active`, `setActiveView`, `openIssueTab`, `addTab`, `closeTab`, `selectTab`
- new: `panes`, `focusedPaneId`, `ratio`, `splitTabRight(tabId)`,
  `moveTabToOtherPane(tabId)`, `swapPanes()`, `focusPane(id)`, `setRatio(n)`,
  `openIssueInRightSplit(issueId)`

`active` resolves to the focused pane's active tab. `selectTab(id)` finds whichever
pane holds the id. `openIssueTab` dedupes across **both** panes (focus if found
anywhere), else opens in the focused pane.

## Layout & components

The single `<main>` in `AppShell` becomes a **`SplitLayout`** rendering 1 or 2
panes with a resizable divider. Each pane is self-contained (VSCode-style):

```
┌─ Pane ─────────────────┐
│  PaneTabStrip          │  ← that pane's tabs + "+"  (rightmost also hosts DualClock)
├────────────────────────┤
│  pane content          │  ← renders the pane's activeTab view, keyed by activeTabId
└────────────────────────┘
```

- **`PaneTabStrip`** — extracted from today's `TabBar`. Renders one pane's tabs,
  its own `+`, and (only on the rightmost pane) the `DualClock`. Single-pane mode
  looks identical to today. Tabs are `draggable`. Right-click opens the new
  `TabContextMenu`.
- **`SplitLayout`** — flex row `[pane][divider][pane]`; widths via
  `flex-basis: ratio*100%` / `(1-ratio)*100%`. One pane → full width; divider and
  drop overlay are inert.
- **Divider** — hairline (`border-border`) with a wider invisible grab area and
  `cursor-col-resize`. Pointer-drag updates `ratio` (via `clampRatio` against the
  live container width); persisted. A **swap button** (`⇄`, `ArrowLeftRight`) sits
  centered on the divider, fading in on hover → `swapPanes()`.
- **Focused pane** — `mousedown` anywhere in a pane sets `focusedPaneId`; the
  focused pane's strip carries a subtle top accent so it's clear which pane the
  Dock / `+` target.

### Tab context menu (`TabContextMenu`, new)

Reuses the fixed-position popover + click-outside/Esc dismiss pattern from
`IssueContextMenu`. Options are state-dependent:

- Single pane: **Open in split (right)** → `splitTabRight(tabId)`.
- Split: **Move to other pane** → `moveTabToOtherPane(tabId)`; **Swap panes** →
  `swapPanes()`.
- Always: **Close** (when more than one tab/pane remains).

### Drag-to-split

Tabs carry `draggable`. On `dragstart`, `dataTransfer` holds `{ tabId, sourcePaneId }`
and a drag-active flag is set in workspace/local state. While a drag is active, the
content body shows a **drop overlay highlighting the right half**; dropping there →
`splitTabRight(tabId)` (or `moveTabToOtherPane` if already split). Dropping a tab
onto the **other pane's strip** → `moveTabToOtherPane`. Dragging the last tab of
the right pane back to the left collapses the split.

## Open a specific issue into the right split

Third way to fill the right pane — by issue, not by existing tab — both routing to
`openIssueInRightSplit(issueId)`:

1. **Issue right-click menu** (`IssueContextMenu.tsx`) — new row **"Open in right
   split"** (`SplitSquareHorizontal` icon), beside "Open details" / "Open in full
   page".

2. **Command palette** (`CommandPalette.tsx`) — new command **"Open issue in right
   split"**. Selecting it switches the palette into a **pick-an-issue sub-mode**:
   the command list collapses, the placeholder/header reads "Open in right split —
   pick an issue…", and only issue search results show. Selecting an issue routes to
   `openIssueInRightSplit` instead of the drawer; `Esc`/back returns to normal mode.
   Modeled with one piece of state — `target: "drawer" | "rightSplit"` (default
   `"drawer"`) — checked in `activate()`.

## Error handling & edge cases

- Drag with a missing/stale `tabId` → no-op.
- Ratio always clamped to keep both panes ≥ 320px; on window resize, the existing
  flex-basis percentages reflow naturally (no stored px).
- Closing the last tab of a pane collapses that pane; closing the last tab overall
  is prevented (keep ≥1, as today).
- `localStorage` failures stay silently swallowed (in-memory fallback), as today.
- The global `IssueDrawer` overlay still works from either pane.

## Testing

Vitest unit tests for the pure reducers and persistence:

- `parsePersisted`: new shape round-trips; **old shape migrates** to one pane;
  malformed → fallback.
- `splitTabRight`, `moveTabToOtherPane`, `swapPanes`, `closeTabIn` (incl. pane
  collapse), `clampRatio`, `openIssueInRightSplit` (single→split and already-split).

Gates: `npx tsc --noEmit`, `npx vitest run`, `npm run build`. (No Rust changes, so
`cargo` gates are unaffected but should still pass.)

## Files

- `src/lib/tabs.tsx` — model, migration, reducers, expanded context. *(grows; if it
  gets large, split pure reducers into `src/lib/paneModel.ts`.)*
- `src/components/SplitLayout.tsx` — new: two-pane layout, divider, resize, swap,
  drop overlay.
- `src/components/PaneTabStrip.tsx` — new: extracted per-pane tab strip (from
  `TabBar`), draggable tabs, right-click menu, DualClock on rightmost.
- `src/components/TabContextMenu.tsx` — new: tab right-click popover.
- `src/components/AppShell.tsx` — render `SplitLayout` instead of single `<main>`.
- `src/components/TabBar.tsx` — removed/absorbed into `PaneTabStrip` (or kept as a
  thin wrapper for the single-pane case).
- `src/features/issues/IssueContextMenu.tsx` — add "Open in right split" row.
- `src/features/command/CommandPalette.tsx` — add command + pick-an-issue sub-mode.
- Test files alongside the reducers.
