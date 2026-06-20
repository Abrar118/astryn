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
- **No Rust logic changes.** Entirely frontend UI state, with one **config-only**
  edit to `src-tauri/tauri.conf.json` (window `minWidth`/`minHeight`).
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
  ratio: number;          // left-pane width fraction, clamped by clampRatio (width-dependent)
  seq: number;            // monotonic id counter (unchanged role)
};
```

### Migration

`parsePersisted` accepts **both** the old shape `{ tabs, activeId, seq }` and the
new shape. An old blob becomes a single pane:
`{ panes: [{ id: "pane-0", tabs, activeTabId: activeId }], focusedPaneId: "pane-0", ratio: 0.5, seq }`.
Existing users' open tabs survive the upgrade. Malformed input falls back to the
same single-calendar-tab default as today.

**Validation invariants (each gets a test):** the parser *repairs toward* a valid
state rather than trusting the blob —

- `panes` must be a non-empty array; **truncate to the first 2** if longer; drop
  panes whose tabs don't validate; if none remain → fallback default.
- Within each pane, tabs are filtered by the existing per-tab rule (valid `view`;
  `issue` tabs require a non-empty `issueId`); a pane that ends up **empty is
  dropped**.
- **Duplicate tab ids and duplicate pane ids are de-duplicated** (first occurrence
  wins) so two panes can't share a tab.
- Each pane's `activeTabId` must be one of its surviving tabs, else → that pane's
  first tab.
- `focusedPaneId` must be a surviving pane id, else → first pane.
- `ratio` must be finite and is run through `clampRatio` (with a default-width
  fallback), else → `0.5`.
- `seq` must be a finite integer **and** `≥ maxExistingTabSeq + 1`; it is raised to
  that floor so a future `tab-${seq}` can never collide with a persisted id.

### ID allocation

- **Tab ids** use the existing `tab-${seq}` counter (`seq` persisted, raised past
  any persisted id on load — see Migration).
- **Pane ids** are allocated separately and collision-free: `nextPaneId(panes)`
  returns the **first unused `pane-${n}`** scanning `n = 0, 1, 2, …` against the
  current pane ids. Since panes max out at 2, this is trivially cheap and can never
  collide with a persisted pane id (e.g. if `pane-0` survived migration, a new pane
  becomes `pane-1`). Tested against arbitrary persisted ids to uphold the global
  uniqueness invariant.

### Pure reducers (unit-tested, mirroring today's `upsertIssueTab`)

All take state + args and return new state; no React, fully testable. Any reducer
that creates a pane uses `nextPaneId`:

- `splitTabRight(state, tabId)` — the **universal "send to the right pane"** op;
  the right-half drop and the tab menu/command all call exactly this, so routing is
  encoded in one place. It resolves by the tab's **source pane**:
  - **tab in the right pane already** → **no-op** (it's already on the right).
  - **tab in the left pane, and a right pane exists** → **move** it into the right
    pane (collapsing the left pane if it was the tab's only tab).
  - **single pane** → ensure a right pane. If the tab is the only tab in the only
    pane, **clone** it (original stays left; a fresh tab — new id from `seq`, same
    `view`/`issueId` — opens right), matching VSCode's "Split Right". Otherwise the
    tab **moves** into a newly created right pane.

  In every non-no-op case the moved/cloned tab becomes the right pane's active tab
  and the right pane is focused (see Invariants).
- `moveTabToOtherPane(state, tabId)` — move a tab from its current pane to the
  other existing pane (used when dropping onto the other pane's strip).
- `swapPanes(state)` — reverse `panes`, set `ratio = 1 - ratio`.
- `closeTabIn(state, tabId)` — remove a tab from its pane; if that empties a pane
  **and** there are 2 panes, drop the pane (the survivor becomes the sole,
  full-width pane). Never closes the last remaining tab of a single pane.
- `clampRatio(ratio, usableWidthPx, minPanePx = 320)` — clamp so neither pane goes
  below `minPanePx` **when the container is wide enough**, and degrade gracefully
  when it is not: `minFraction = Math.min(0.5, minPanePx / usableWidthPx)`, then
  clamp `ratio` to `[minFraction, 1 - minFraction]`. When `usableWidth < 2*minPanePx`
  the formula caps at `0.5` (equal panes, both below 320 — symmetric, not broken).
  `usableWidth` = container width minus the divider width. Non-finite inputs → `0.5`.
- `openIssueInRightSplit(state, issueId)` — opens the issue as a tab in the right
  pane **without disturbing the left pane**. It does **not** call `splitTabRight`
  (which would move/clone the active left tab). Precisely:
  - **right-pane-first:** when split, if a copy of the issue is **already in the
    right pane**, just focus/activate it there and leave the left pane untouched —
    never move a left copy when a right copy exists. (Without this, an issue present
    in both panes — e.g. after a clone-on-split of a sole issue tab — would move the
    left copy right and collapse the split.)
  - **single pane** → create a new right pane (fresh `pane-${n}`) containing **only**
    a new issue tab (deduped: if an issue tab for `issueId` already exists anywhere,
    move/focus it instead of duplicating); the left pane is untouched.
  - **already split** → open-or-focus the issue tab in the existing right pane
    (dedupe within the whole workspace).
  - **sole-issue edge case** → if the requested issue is itself the *only* tab in the
    *only* pane, cloning would create a second tab with the same `issueId` and break
    dedup. Instead, a fresh `calendar` tab replaces it on the left and the issue tab
    moves to the new right pane — exactly one tab per issue is preserved.

  In both cases the issue tab becomes the right pane's active tab and the right pane
  is focused.

### Invariants & postconditions (tested)

Global invariants that hold after **every** reducer: `panes.length ∈ {1,2}`; every
pane has ≥1 tab; every pane's `activeTabId` is one of its own tabs; all tab ids and
pane ids are globally unique; `focusedPaneId` is an existing pane.

Per-operation postconditions:

| Op | active | focused | source-pane fate |
| --- | --- | --- | --- |
| `splitTabRight` | moved/cloned tab is right pane's active (no-op if tab already in right pane) | right pane (unchanged on no-op) | left keeps original (clone) or its remaining tabs (move); collapses if it was the tab's only tab |
| `moveTabToOtherPane` | moved tab is destination's active | destination pane | if moved tab was source's active, source selects **neighbor** (same index clamped, else previous); if source empties → collapse pane |
| `closeTabIn` | if closed tab was active, **neighbor** becomes active | unchanged, unless its pane collapsed → focus survivor | if pane empties & 2 panes → drop pane; single pane's last tab → no-op |
| `addTabIn` | new tab | that pane | n/a |
| `swapPanes` | unchanged per pane | unchanged (same pane object) | n/a; `ratio → 1-ratio` |
| `openIssueInRightSplit` | issue tab in right pane | right pane | n/a |

"Neighbor" = the tab now occupying the closed tab's index, else the previous tab.

### Context API (`useWorkspace`)

Keeps its current surface, all retargeted to the **focused pane** so existing
consumers (Dock, CommandPalette, IssueContextMenu, TabBar) keep working:

- existing: `active`, `setActiveView`, `openIssueTab`, `addTab`, `closeTab`, `selectTab`
- new: `panes`, `focusedPaneId`, `ratio`, `splitTabRight(tabId)`,
  `moveTabToOtherPane(tabId)`, `swapPanes()`, `focusPane(id)`, `setRatio(n)`,
  `openIssueInRightSplit(issueId)`, **`addTabIn(paneId, view?)`**

`active` resolves to the focused pane's active tab. `selectTab(id)` finds whichever
pane holds the id. `openIssueTab` dedupes across **both** panes (focus if found
anywhere), else opens in the focused pane.

**Explicit-id contract (no reliance on focus event ordering).** Focus
(`focusedPaneId`, set on pane `mousedown`) is a *convenience* for the Dock and
keyboard only — it is **never** the source of truth for which pane/tab an action
mutates. Pane-scoped UI passes ids explicitly:

- Each `PaneTabStrip`'s `+` calls `addTabIn(thatPaneId)`, not `addTab()`.
  (`addTab()` stays as the Dock's "new tab in focused pane" convenience.)
- `closeTab(id)` already takes an explicit id; tab close buttons pass their own
  tab's id (as today).
- `IssuePage` takes an explicit **`tabId`** prop and closes *that* id
  (`onClose={() => closeTab(tabId)}`), replacing the current `closeTab(active.id)`
  which would close the wrong tab when the issue page is in the non-focused pane.
  `SplitLayout` passes each pane's `activeTabId` as the `tabId` when rendering an
  issue view.

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
  live container width); persisted. The pointer handler is registered on
  `pointerdown` and **torn down on `pointerup` and `pointercancel`** (and on unmount)
  so a drag can't leak listeners. The `SplitLayout` container is observed with a
  **`ResizeObserver`** that re-runs `clampRatio` whenever the window/container
  resizes, so a shrunk window never strands a pane below the minimum.
  **Accessibility:** the divider is `role="separator"` `aria-orientation="vertical"`,
  `tabIndex=0`, with `aria-valuenow`/`aria-valuemin`/`aria-valuemax` reflecting the
  left-pane percentage; **ArrowLeft/ArrowRight resize by a 2% step** (clamped), and
  it shows a `focus-visible` ring.
- **Swap button** (`⇄`, `ArrowLeftRight`) — a real `<button aria-label="Swap panes">`
  centered on the divider, fading in on hover **and** on `focus-visible` (so it is
  keyboard-reachable, not hover-only) → `swapPanes()`.
- **Window minimum width** — `src-tauri/tauri.conf.json` gains `minWidth: 800`
  (and `minHeight: 600`) on the main window so the usable area comfortably exceeds
  `2 × 320px + divider`; `clampRatio` still guarantees correctness below that if the
  platform ever ignores the hint. *(Config-only change; no Rust logic.)*
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
content body shows a **drop overlay highlighting the right half**; dropping there
**always calls `splitTabRight(tabId)`** — which is a no-op for a tab already in the
right pane, so dragging a right-pane tab onto the right half can never move it left.
Dropping a tab onto the **other pane's strip** → `moveTabToOtherPane`. Dragging the
last tab of the right pane back to the left collapses the split.

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
- Ratio is clamped to keep both panes ≥ 320px **when the window is wide enough**
  (≥ ~660px usable); below that, `clampRatio` degrades to equal panes rather than
  breaking. A `ResizeObserver` re-clamps on resize; flex-basis percentages reflow
  naturally (no stored px). Window `minWidth: 800` keeps the normal case safe.
- Closing the last tab of a pane collapses that pane; closing the last tab overall
  is prevented (keep ≥1, as today).
- `localStorage` failures stay silently swallowed (in-memory fallback), as today.
- The global `IssueDrawer` overlay still works from either pane.

## Testing

**Pure reducers & persistence (Vitest):**

- `parsePersisted`: new shape round-trips; **old shape migrates** to one pane;
  malformed → fallback; plus one test per validation invariant above (empty panes,
  >2 panes, duplicate pane/tab ids, invalid active id, invalid focused pane,
  non-finite ratio/seq, seq-below-floor).
- `splitTabRight` — clone-the-sole-tab, move-from-left, **no-op when tab already in
  right pane**, and move-collapses-source.
- `nextPaneId` — returns the first unused `pane-${n}` against arbitrary persisted
  pane ids (uniqueness invariant).
- `moveTabToOtherPane` (incl. source neighbor-selection and source collapse),
  `swapPanes`, `closeTabIn` (active→neighbor, pane collapse, last-tab no-op),
  `clampRatio` (wide, exactly-2×min, narrower-than-2×min, non-finite).
- `openIssueInRightSplit` — single→new-right-pane with the **left pane unchanged**,
  already-split, and dedupe across the workspace.
- Every reducer test also asserts the **global invariants** hold on the result.

**Focused component tests (`@testing-library/react` + jsdom — already in deps):**

- `PaneTabStrip`: the pane-local `+` adds to *that* pane (not the focused one);
  close button closes its own tab.
- `IssuePage`: `onClose` closes the **passed `tabId`**, not `active.id`.
- `CommandPalette`: selecting "Open issue in right split" enters the sub-mode
  (command list hidden, issue-only results); selecting an issue routes to
  `openIssueInRightSplit`; **first `Esc` returns to normal mode**, second `Esc`
  closes.
- Divider: pointer-drag updates ratio and **listeners are removed on `pointerup`**;
  ArrowLeft/ArrowRight resize by the step.
- Drag-drop routing: a `drop` on the right-half overlay calls `splitTabRight` with
  the dragged tab id.

**Manual `npm run tauri dev` verification pass** (recorded in the plan): split from
the default single tab via all three entry points; resize + swap; collapse back to
single; drag a tab to the right half; verify persistence across reload and the
old→new migration (seed an old-shape `localStorage` blob).

Gates: `npx tsc --noEmit`, `npx vitest run`, `npm run build`, plus
`cargo test/clippy/fmt` (unaffected by the config-only `tauri.conf.json` change but
must stay green).

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
- `src/features/drawer/IssuePage.tsx` — take an explicit `tabId` prop; close it.
- `src-tauri/tauri.conf.json` — add window `minWidth`/`minHeight` (config only).
- Test files: reducers + persistence (`*.test.ts`) and the focused component tests
  (`*.test.tsx`).
