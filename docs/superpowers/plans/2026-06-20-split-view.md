# Split-View (Two-Pane Workspace) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VSCode-style two-pane split-screen to the tabbed workspace: show two tabs side by side, each pane an independent tab group, resizable and swappable.

**Architecture:** A pure state model (`src/lib/paneModel.ts`) holds panes-that-own-tabs and all reducers; `WorkspaceProvider` (`src/lib/tabs.tsx`) wraps it in React context with the existing surface retargeted to the focused pane plus new split methods; `SplitLayout` renders 1–2 panes with a draggable divider, drop overlay, and swap control; per-pane `PaneTabStrip` replaces the global `TabBar`.

**Tech Stack:** React 19 + TypeScript (strict), TanStack Query, Tailwind v4, lucide-react, Vitest + @testing-library/react (jsdom), Tauri v2.

> **Note on TDD:** Tasks 1, 2, 4, 5, 6, 8 are test-first (a failing test precedes the implementation). Tasks 3 (provider rewrite) and 7 (add one context-menu row) are refactor/wiring with no new unit boundary — they are guarded by the *existing* suite plus `tsc --noEmit` rather than a new failing test. This is intentional, not an omission.

## Global Constraints

- **No new dependencies.** The resizable divider is a hand-rolled pointer handler, not `react-resizable-panels`.
- **No Rust logic changes.** Only a config edit to `src-tauri/tauri.conf.json` (window `minWidth`/`minHeight`).
- **TS is strict** with `noUnusedLocals`/`noUnusedParameters` — no unused symbols.
- **Use ripgrep (`rg`)**, not grep.
- **Exactly two panes, side-by-side.** State is a pair, never a tree. `panes.length ∈ {1,2}`.
- **Minimum pane width 320px**; window `minWidth: 800`.
- **DnD marker type:** `application/x-astryn-tab` (constant `TAB_DND_TYPE`).
- **localStorage key:** `astryn.workspace` (unchanged).
- **Commit messages end with:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Gates per task: `npx tsc --noEmit` and `npx vitest run` (the touched files). Final task also runs `npm run build`.

---

### Task 1: Pane model — types, persistence & migration (pure)

**Files:**
- Create: `src/lib/paneModel.ts`
- Test: `src/lib/paneModel.test.ts`

**Interfaces:**
- Consumes: nothing (pure leaf module).
- Produces:
  - `type ViewKind = "calendar" | "list" | "inbox" | "settings" | "issue"`
  - `type Tab = { id: string; view: ViewKind; issueId?: string }`
  - `type Pane = { id: string; tabs: Tab[]; activeTabId: string }`
  - `type WorkspaceState = { panes: Pane[]; focusedPaneId: string; ratio: number; seq: number }`
  - `const VIEWS: ViewKind[]`, `const MIN_PANE_PX = 320`, `const FALLBACK: WorkspaceState`
  - `parsePersisted(raw: string | null): WorkspaceState`
  - `nextPaneId(panes: Pane[]): string`
  - `clampRatio(ratio: number, usableWidthPx: number, minPanePx?: number): number`

- [ ] **Step 1: Write the failing test**

Create `src/lib/paneModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parsePersisted, nextPaneId, clampRatio, FALLBACK } from "./paneModel";
import type { Pane } from "./paneModel";

describe("clampRatio", () => {
  it("keeps both panes >= min when wide", () => {
    expect(clampRatio(0.5, 1000)).toBe(0.5);
    expect(clampRatio(0.1, 1000)).toBeCloseTo(0.32, 5); // 320/1000
    expect(clampRatio(0.9, 1000)).toBeCloseTo(0.68, 5);
  });
  it("collapses to equal panes at exactly 2x min and narrower", () => {
    expect(clampRatio(0.2, 640)).toBe(0.5);
    expect(clampRatio(0.8, 500)).toBe(0.5);
  });
  it("returns 0.5 for non-finite inputs", () => {
    expect(clampRatio(NaN, 1000)).toBe(0.5);
    expect(clampRatio(0.5, 0)).toBe(0.5);
  });
});

describe("nextPaneId", () => {
  it("returns the first unused pane-N against existing ids", () => {
    const panes: Pane[] = [{ id: "pane-0", tabs: [{ id: "tab-0", view: "calendar" }], activeTabId: "tab-0" }];
    expect(nextPaneId(panes)).toBe("pane-1");
    expect(nextPaneId([{ id: "pane-1", tabs: panes[0].tabs, activeTabId: "tab-0" }])).toBe("pane-0");
  });
});

describe("parsePersisted", () => {
  it("migrates the old {tabs,activeId,seq} shape to a single pane", () => {
    const raw = JSON.stringify({ tabs: [{ id: "tab-0", view: "calendar" }, { id: "tab-1", view: "issue", issueId: "iss-1" }], activeId: "tab-1", seq: 2 });
    const s = parsePersisted(raw);
    expect(s.panes).toHaveLength(1);
    expect(s.panes[0].id).toBe("pane-0");
    expect(s.panes[0].tabs.map((t) => t.id)).toEqual(["tab-0", "tab-1"]);
    expect(s.panes[0].activeTabId).toBe("tab-1");
    expect(s.focusedPaneId).toBe("pane-0");
    expect(s.ratio).toBe(0.5);
  });
  it("round-trips a valid new shape", () => {
    const state = { panes: [{ id: "pane-0", tabs: [{ id: "tab-0", view: "calendar" }], activeTabId: "tab-0" }, { id: "pane-1", tabs: [{ id: "tab-1", view: "list" }], activeTabId: "tab-1" }], focusedPaneId: "pane-1", ratio: 0.4, seq: 2 };
    expect(parsePersisted(JSON.stringify(state))).toEqual(state);
  });
  it("drops invalid issue tabs, empty panes, and truncates to two panes", () => {
    const raw = JSON.stringify({
      panes: [
        { id: "pane-0", tabs: [{ id: "tab-0", view: "calendar" }, { id: "tab-x", view: "issue" }], activeTabId: "tab-0" },
        { id: "pane-1", tabs: [], activeTabId: "tab-9" },
        { id: "pane-2", tabs: [{ id: "tab-2", view: "list" }], activeTabId: "tab-2" },
      ],
      focusedPaneId: "pane-1", ratio: 0.5, seq: 3,
    });
    const s = parsePersisted(raw);
    expect(s.panes.map((p) => p.id)).toEqual(["pane-0", "pane-2"]); // empty pane-1 dropped, then <=2
    expect(s.panes[0].tabs.map((t) => t.id)).toEqual(["tab-0"]); // invalid issue tab dropped
    expect(s.focusedPaneId).toBe("pane-0"); // focused pane-1 vanished -> first
  });
  it("de-dupes tab ids across panes and repairs an out-of-pane activeTabId", () => {
    const raw = JSON.stringify({
      panes: [
        { id: "pane-0", tabs: [{ id: "tab-0", view: "calendar" }], activeTabId: "tab-999" },
        { id: "pane-1", tabs: [{ id: "tab-0", view: "list" }], activeTabId: "tab-0" },
      ],
      focusedPaneId: "pane-0", ratio: 0.5, seq: 1,
    });
    const s = parsePersisted(raw);
    expect(s.panes).toHaveLength(1); // pane-1's only tab duped pane-0's -> emptied -> dropped
    expect(s.panes[0].id).toBe("pane-0");
    expect(s.panes[0].activeTabId).toBe("tab-0"); // out-of-pane active repaired to first tab
  });
  it("raises seq past the highest persisted tab id", () => {
    const raw = JSON.stringify({ panes: [{ id: "pane-0", tabs: [{ id: "tab-7", view: "calendar" }], activeTabId: "tab-7" }], focusedPaneId: "pane-0", ratio: 0.5, seq: 1 });
    expect(parsePersisted(raw).seq).toBe(8);
  });
  it("defaults non-finite ratio/seq and falls back on garbage", () => {
    const raw = JSON.stringify({ panes: [{ id: "pane-0", tabs: [{ id: "tab-0", view: "calendar" }], activeTabId: "tab-0" }], focusedPaneId: "pane-0", ratio: "x", seq: "y" });
    const s = parsePersisted(raw);
    expect(s.ratio).toBe(0.5);
    expect(s.seq).toBe(1); // max(0, maxTabSeq 0 + 1)
    expect(parsePersisted("{not json").panes[0].tabs[0].view).toBe("calendar");
    expect(parsePersisted(null)).toEqual(FALLBACK);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/paneModel.test.ts`
Expected: FAIL — `Failed to resolve import "./paneModel"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/paneModel.ts`:

```ts
export type ViewKind = "calendar" | "list" | "inbox" | "settings" | "issue";
export type Tab = { id: string; view: ViewKind; issueId?: string };
export type Pane = { id: string; tabs: Tab[]; activeTabId: string };
export type WorkspaceState = {
  panes: Pane[]; // length 1 (single) or 2 (split: [left, right])
  focusedPaneId: string;
  ratio: number; // left-pane width fraction
  seq: number; // monotonic tab-id counter
};

export const VIEWS: ViewKind[] = ["calendar", "list", "inbox", "settings", "issue"];
export const MIN_PANE_PX = 320;

export const FALLBACK: WorkspaceState = {
  panes: [{ id: "pane-0", tabs: [{ id: "tab-0", view: "calendar" }], activeTabId: "tab-0" }],
  focusedPaneId: "pane-0",
  ratio: 0.5,
  seq: 1,
};

export function clampRatio(ratio: number, usableWidthPx: number, minPanePx = MIN_PANE_PX): number {
  if (!Number.isFinite(ratio) || !Number.isFinite(usableWidthPx) || usableWidthPx <= 0) return 0.5;
  const minFraction = Math.min(0.5, minPanePx / usableWidthPx);
  return Math.min(1 - minFraction, Math.max(minFraction, ratio));
}

export function nextPaneId(panes: Pane[]): string {
  for (let n = 0; ; n++) {
    const id = `pane-${n}`;
    if (!panes.some((p) => p.id === id)) return id;
  }
}

function isViewKind(v: unknown): v is ViewKind {
  return typeof v === "string" && (VIEWS as string[]).includes(v);
}

function validTab(t: unknown): t is Tab {
  const tab = t as Tab;
  if (!tab || typeof tab.id !== "string" || !isViewKind(tab.view)) return false;
  if (tab.view === "issue" && !(typeof tab.issueId === "string" && tab.issueId.length > 0)) return false;
  return true;
}

function maxTabSeq(panes: Pane[]): number {
  let max = -1;
  for (const p of panes) {
    for (const t of p.tabs) {
      const m = /^tab-(\d+)$/.exec(t.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max;
}

/** Rebuild a state that satisfies every global invariant, dropping/repairing bad parts. */
function repair(input: Partial<WorkspaceState>): WorkspaceState {
  const seenTabIds = new Set<string>();
  const seenPaneIds = new Set<string>();
  const panes: Pane[] = [];
  for (const raw of Array.isArray(input.panes) ? input.panes : []) {
    if (panes.length >= 2) break; // truncate to two
    if (!raw || typeof raw.id !== "string" || seenPaneIds.has(raw.id)) continue;
    const tabs: Tab[] = [];
    for (const t of Array.isArray(raw.tabs) ? raw.tabs : []) {
      if (!validTab(t) || seenTabIds.has(t.id)) continue;
      seenTabIds.add(t.id);
      tabs.push(t.issueId ? { id: t.id, view: t.view, issueId: t.issueId } : { id: t.id, view: t.view });
    }
    if (tabs.length === 0) continue; // drop empty pane
    const activeTabId = tabs.some((t) => t.id === raw.activeTabId) ? raw.activeTabId : tabs[0].id;
    seenPaneIds.add(raw.id);
    panes.push({ id: raw.id, tabs, activeTabId });
  }
  if (panes.length === 0) return FALLBACK;
  const focusedPaneId = panes.some((p) => p.id === input.focusedPaneId) ? (input.focusedPaneId as string) : panes[0].id;
  const ratio = clampRatio(input.ratio as number, 1000);
  const seq = Math.max(Number.isFinite(input.seq) ? Math.floor(input.seq as number) : 0, maxTabSeq(panes) + 1);
  return { panes, focusedPaneId, ratio, seq };
}

export function parsePersisted(raw: string | null): WorkspaceState {
  if (!raw) return FALLBACK;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return FALLBACK;
  }
  if (!parsed || typeof parsed !== "object") return FALLBACK;
  const obj = parsed as Record<string, unknown>;

  if (Array.isArray(obj.panes)) {
    return repair(obj as unknown as Partial<WorkspaceState>);
  }
  // Old shape migration: { tabs, activeId, seq } -> one pane.
  if (Array.isArray(obj.tabs)) {
    const tabs = (obj.tabs as unknown[]).filter(validTab) as Tab[];
    if (tabs.length === 0) return FALLBACK;
    const activeTabId = typeof obj.activeId === "string" ? obj.activeId : tabs[0].id;
    return repair({
      panes: [{ id: "pane-0", tabs, activeTabId }],
      focusedPaneId: "pane-0",
      ratio: 0.5,
      seq: typeof obj.seq === "number" ? obj.seq : tabs.length,
    });
  }
  return FALLBACK;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/paneModel.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck & commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/paneModel.ts src/lib/paneModel.test.ts
git commit -m "feat(split-view): pane model types, persistence & migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Pane reducers (pure)

**Files:**
- Modify: `src/lib/paneModel.ts` (append reducers)
- Test: `src/lib/paneModel.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 types/helpers (`WorkspaceState`, `Pane`, `Tab`, `nextPaneId`).
- Produces:
  - `addTabIn(state, paneId, view?): WorkspaceState`
  - `closeTabIn(state, tabId): WorkspaceState`
  - `splitTabRight(state, tabId): WorkspaceState`
  - `moveTabToOtherPane(state, tabId): WorkspaceState`
  - `swapPanes(state): WorkspaceState`
  - `selectTabIn(state, tabId): WorkspaceState`
  - `openIssueTabAcross(state, issueId): WorkspaceState`
  - `openIssueInRightSplit(state, issueId): WorkspaceState`
  - `assertInvariants(state): void`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/paneModel.test.ts`:

```ts
import {
  addTabIn, closeTabIn, splitTabRight, moveTabToOtherPane, swapPanes,
  selectTabIn, openIssueTabAcross, openIssueInRightSplit, assertInvariants,
} from "./paneModel";
import type { WorkspaceState } from "./paneModel";

const single = (): WorkspaceState => ({
  panes: [{ id: "pane-0", tabs: [{ id: "tab-0", view: "calendar" }], activeTabId: "tab-0" }],
  focusedPaneId: "pane-0", ratio: 0.5, seq: 1,
});
const multiTab = (): WorkspaceState => ({
  panes: [{ id: "pane-0", tabs: [{ id: "tab-0", view: "calendar" }, { id: "tab-1", view: "list" }], activeTabId: "tab-1" }],
  focusedPaneId: "pane-0", ratio: 0.5, seq: 2,
});
const split = (): WorkspaceState => ({
  panes: [
    { id: "pane-0", tabs: [{ id: "tab-0", view: "calendar" }], activeTabId: "tab-0" },
    { id: "pane-1", tabs: [{ id: "tab-1", view: "list" }], activeTabId: "tab-1" },
  ],
  focusedPaneId: "pane-0", ratio: 0.5, seq: 2,
});

describe("splitTabRight", () => {
  it("clones the sole tab into a new right pane (left unchanged)", () => {
    const s = splitTabRight(single(), "tab-0");
    expect(s.panes).toHaveLength(2);
    expect(s.panes[0].tabs.map((t) => t.id)).toEqual(["tab-0"]);
    expect(s.panes[1].id).toBe("pane-1");
    expect(s.panes[1].tabs[0]).toEqual({ id: "tab-1", view: "calendar" });
    expect(s.focusedPaneId).toBe("pane-1");
    assertInvariants(s);
  });
  it("moves a non-sole tab into a new right pane, leaving the source active sane", () => {
    const s = splitTabRight(multiTab(), "tab-1");
    expect(s.panes[0].tabs.map((t) => t.id)).toEqual(["tab-0"]);
    expect(s.panes[0].activeTabId).toBe("tab-0");
    expect(s.panes[1].tabs.map((t) => t.id)).toEqual(["tab-1"]);
    assertInvariants(s);
  });
  it("is a no-op when the tab is already in the right pane", () => {
    const s0 = split();
    expect(splitTabRight(s0, "tab-1")).toBe(s0);
  });
  it("moves a left-pane tab into the existing right pane", () => {
    const s = splitTabRight(split(), "tab-0");
    expect(s.panes).toHaveLength(1); // left emptied -> collapse
    expect(s.panes[0].id).toBe("pane-1");
    expect(s.panes[0].tabs.map((t) => t.id)).toEqual(["tab-1", "tab-0"]);
    assertInvariants(s);
  });
});

describe("moveTabToOtherPane", () => {
  it("moves between panes and selects a source neighbor", () => {
    const base = split();
    base.panes[0].tabs.push({ id: "tab-2", view: "inbox" });
    base.panes[0].activeTabId = "tab-0";
    const s = moveTabToOtherPane(base, "tab-0");
    expect(s.panes[0].tabs.map((t) => t.id)).toEqual(["tab-2"]);
    expect(s.panes[0].activeTabId).toBe("tab-2");
    expect(s.panes[1].activeTabId).toBe("tab-0");
    expect(s.focusedPaneId).toBe("pane-1");
    assertInvariants(s);
  });
});

describe("closeTabIn", () => {
  it("no-ops on the last tab of a single pane", () => {
    const s0 = single();
    expect(closeTabIn(s0, "tab-0")).toBe(s0);
  });
  it("selects a neighbor when closing the active tab", () => {
    const s = closeTabIn(multiTab(), "tab-1");
    expect(s.panes[0].tabs.map((t) => t.id)).toEqual(["tab-0"]);
    expect(s.panes[0].activeTabId).toBe("tab-0");
    assertInvariants(s);
  });
  it("collapses an emptied pane and focuses the survivor", () => {
    const s = closeTabIn(split(), "tab-1");
    expect(s.panes).toHaveLength(1);
    expect(s.panes[0].id).toBe("pane-0");
    expect(s.focusedPaneId).toBe("pane-0");
    assertInvariants(s);
  });
});

describe("addTabIn / selectTabIn / swapPanes", () => {
  it("adds a tab to the named pane and focuses it", () => {
    const s = addTabIn(split(), "pane-1", "inbox");
    expect(s.panes[1].tabs.map((t) => t.view)).toEqual(["list", "inbox"]);
    expect(s.panes[1].activeTabId).toBe("tab-2");
    expect(s.focusedPaneId).toBe("pane-1");
    expect(s.seq).toBe(3);
    assertInvariants(s);
  });
  it("selectTabIn activates the tab and focuses its owning pane", () => {
    const s = selectTabIn(split(), "tab-1");
    expect(s.focusedPaneId).toBe("pane-1");
    expect(s.panes[1].activeTabId).toBe("tab-1");
  });
  it("swapPanes reverses panes and flips the ratio", () => {
    const s = swapPanes({ ...split(), ratio: 0.3 });
    expect(s.panes.map((p) => p.id)).toEqual(["pane-1", "pane-0"]);
    expect(s.ratio).toBeCloseTo(0.7, 5);
    assertInvariants(s);
  });
});

describe("openIssueInRightSplit / openIssueTabAcross", () => {
  it("creates a right pane with only the issue tab, leaving the left untouched", () => {
    const s = openIssueInRightSplit(single(), "iss-9");
    expect(s.panes[0].tabs.map((t) => t.id)).toEqual(["tab-0"]); // left unchanged
    expect(s.panes[1].tabs[0]).toEqual({ id: "tab-1", view: "issue", issueId: "iss-9" });
    expect(s.focusedPaneId).toBe("pane-1");
    assertInvariants(s);
  });
  it("opens into the existing right pane when already split", () => {
    const s = openIssueInRightSplit(split(), "iss-9");
    expect(s.panes[1].tabs.map((t) => t.view)).toEqual(["list", "issue"]);
    assertInvariants(s);
  });
  it("focuses an already-open issue tab in the right pane instead of duplicating", () => {
    const base = openIssueInRightSplit(single(), "iss-9");
    const again = openIssueInRightSplit(base, "iss-9");
    expect(again.panes[1].tabs).toHaveLength(1);
    expect(again.focusedPaneId).toBe("pane-1");
  });
  it("preserves dedup for a sole issue tab: replaces left with calendar, moves issue right", () => {
    const s0: WorkspaceState = {
      panes: [{ id: "pane-0", tabs: [{ id: "tab-0", view: "issue", issueId: "iss-1" }], activeTabId: "tab-0" }],
      focusedPaneId: "pane-0", ratio: 0.5, seq: 1,
    };
    const s = openIssueInRightSplit(s0, "iss-1");
    expect(s.panes).toHaveLength(2);
    expect(s.panes[0].tabs).toEqual([{ id: "tab-1", view: "calendar" }]); // fresh replacement left
    expect(s.panes[1].tabs).toEqual([{ id: "tab-0", view: "issue", issueId: "iss-1" }]); // same tab, NOT cloned
    expect(s.focusedPaneId).toBe("pane-1");
    expect(s.panes.flatMap((p) => p.tabs).filter((t) => t.issueId === "iss-1")).toHaveLength(1); // dedup held
    assertInvariants(s);
  });
  it("moves an issue open in the left pane into a NEW right pane (single)", () => {
    const s0: WorkspaceState = {
      panes: [{ id: "pane-0", tabs: [{ id: "tab-0", view: "calendar" }, { id: "tab-1", view: "issue", issueId: "iss-1" }], activeTabId: "tab-0" }],
      focusedPaneId: "pane-0", ratio: 0.5, seq: 2,
    };
    const s = openIssueInRightSplit(s0, "iss-1");
    expect(s.panes).toHaveLength(2);
    expect(s.panes[0].tabs.map((t) => t.id)).toEqual(["tab-0"]);
    expect(s.panes[1].tabs.map((t) => t.id)).toEqual(["tab-1"]);
    expect(s.focusedPaneId).toBe("pane-1");
    assertInvariants(s);
  });
  it("moves an issue open in the left pane into the EXISTING right pane (split)", () => {
    const s0: WorkspaceState = {
      panes: [
        { id: "pane-0", tabs: [{ id: "tab-0", view: "calendar" }, { id: "tab-1", view: "issue", issueId: "iss-1" }], activeTabId: "tab-0" },
        { id: "pane-1", tabs: [{ id: "tab-2", view: "list" }], activeTabId: "tab-2" },
      ],
      focusedPaneId: "pane-0", ratio: 0.5, seq: 3,
    };
    const s = openIssueInRightSplit(s0, "iss-1");
    expect(s.panes[0].tabs.map((t) => t.id)).toEqual(["tab-0"]);
    expect(s.panes[1].tabs.map((t) => t.id)).toEqual(["tab-2", "tab-1"]);
    expect(s.focusedPaneId).toBe("pane-1");
    assertInvariants(s);
  });
  it("openIssueTabAcross adds to the focused pane when not open anywhere", () => {
    const s = openIssueTabAcross(split(), "iss-3");
    expect(s.panes[0].tabs.map((t) => t.view)).toEqual(["calendar", "issue"]);
    expect(s.focusedPaneId).toBe("pane-0");
    assertInvariants(s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/paneModel.test.ts`
Expected: FAIL — reducers not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/paneModel.ts`:

```ts
function findTab(state: WorkspaceState, tabId: string): { paneIdx: number; tabIdx: number } | null {
  for (let pi = 0; pi < state.panes.length; pi++) {
    const ti = state.panes[pi].tabs.findIndex((t) => t.id === tabId);
    if (ti >= 0) return { paneIdx: pi, tabIdx: ti };
  }
  return null;
}

/** After removing the tab at `originalIdx`, pick the new active id from the remaining tabs. */
function neighborId(originalIdx: number, rem: Tab[]): string {
  return (rem[originalIdx] ?? rem[originalIdx - 1] ?? rem[0]).id;
}

/** Move `tabId` from pane `srcIdx` to pane `destIdx`; collapse the source if it empties. */
function moveTabCore(state: WorkspaceState, tabId: string, srcIdx: number, tabIdx: number, destIdx: number): WorkspaceState {
  const src = state.panes[srcIdx];
  const dest = state.panes[destIdx];
  const tab = src.tabs[tabIdx];
  const remain = src.tabs.filter((t) => t.id !== tabId);
  const destPane: Pane = { ...dest, tabs: [...dest.tabs, tab], activeTabId: tabId };
  if (remain.length === 0) {
    return { ...state, panes: [destPane], focusedPaneId: destPane.id };
  }
  const srcActive = src.activeTabId === tabId ? neighborId(tabIdx, remain) : src.activeTabId;
  const srcPane: Pane = { ...src, tabs: remain, activeTabId: srcActive };
  const panes = srcIdx < destIdx ? [srcPane, destPane] : [destPane, srcPane];
  return { ...state, panes, focusedPaneId: destPane.id };
}

export function addTabIn(state: WorkspaceState, paneId: string, view: ViewKind = "calendar"): WorkspaceState {
  const idx = state.panes.findIndex((p) => p.id === paneId);
  if (idx < 0) return state;
  const id = `tab-${state.seq}`;
  const tab: Tab = { id, view };
  const panes = state.panes.map((p, i) => (i === idx ? { ...p, tabs: [...p.tabs, tab], activeTabId: id } : p));
  return { ...state, panes, focusedPaneId: paneId, seq: state.seq + 1 };
}

export function closeTabIn(state: WorkspaceState, tabId: string): WorkspaceState {
  const loc = findTab(state, tabId);
  if (!loc) return state;
  const { paneIdx, tabIdx } = loc;
  const pane = state.panes[paneIdx];
  if (state.panes.length === 1 && pane.tabs.length === 1) return state; // keep >= 1 tab
  const rem = pane.tabs.filter((t) => t.id !== tabId);
  if (rem.length === 0) {
    const survivor = state.panes[1 - paneIdx];
    return { ...state, panes: [survivor], focusedPaneId: survivor.id };
  }
  const activeTabId = pane.activeTabId === tabId ? neighborId(tabIdx, rem) : pane.activeTabId;
  const panes = state.panes.map((p, i) => (i === paneIdx ? { ...p, tabs: rem, activeTabId } : p));
  return { ...state, panes };
}

export function splitTabRight(state: WorkspaceState, tabId: string): WorkspaceState {
  const loc = findTab(state, tabId);
  if (!loc) return state;
  const { paneIdx, tabIdx } = loc;
  if (state.panes.length === 2) {
    if (paneIdx === 1) return state; // already on the right
    return moveTabCore(state, tabId, 0, tabIdx, 1);
  }
  const src = state.panes[0];
  const tab = src.tabs[tabIdx];
  if (src.tabs.length === 1) {
    const cloneId = `tab-${state.seq}`;
    const clone: Tab = tab.issueId ? { id: cloneId, view: tab.view, issueId: tab.issueId } : { id: cloneId, view: tab.view };
    const right: Pane = { id: nextPaneId(state.panes), tabs: [clone], activeTabId: cloneId };
    return { ...state, panes: [src, right], focusedPaneId: right.id, seq: state.seq + 1 };
  }
  const remain = src.tabs.filter((t) => t.id !== tabId);
  const left: Pane = { ...src, tabs: remain, activeTabId: src.activeTabId === tabId ? neighborId(tabIdx, remain) : src.activeTabId };
  const right: Pane = { id: nextPaneId(state.panes), tabs: [tab], activeTabId: tabId };
  return { ...state, panes: [left, right], focusedPaneId: right.id };
}

export function moveTabToOtherPane(state: WorkspaceState, tabId: string): WorkspaceState {
  if (state.panes.length !== 2) return state;
  const loc = findTab(state, tabId);
  if (!loc) return state;
  return moveTabCore(state, tabId, loc.paneIdx, loc.tabIdx, 1 - loc.paneIdx);
}

export function swapPanes(state: WorkspaceState): WorkspaceState {
  if (state.panes.length !== 2) return state;
  // Pure reducer: exact mirror. Live-width clamping is SplitLayout's job.
  return { ...state, panes: [state.panes[1], state.panes[0]], ratio: 1 - state.ratio };
}

export function selectTabIn(state: WorkspaceState, tabId: string): WorkspaceState {
  const loc = findTab(state, tabId);
  if (!loc) return state;
  const panes = state.panes.map((p, i) => (i === loc.paneIdx ? { ...p, activeTabId: tabId } : p));
  return { ...state, panes, focusedPaneId: state.panes[loc.paneIdx].id };
}

function findIssueTab(state: WorkspaceState, issueId: string): { paneIdx: number; tabId: string } | null {
  for (let pi = 0; pi < state.panes.length; pi++) {
    const t = state.panes[pi].tabs.find((x) => x.view === "issue" && x.issueId === issueId);
    if (t) return { paneIdx: pi, tabId: t.id };
  }
  return null;
}

function addIssueTabIn(state: WorkspaceState, paneId: string, issueId: string): WorkspaceState {
  const idx = state.panes.findIndex((p) => p.id === paneId);
  if (idx < 0) return state;
  const id = `tab-${state.seq}`;
  const tab: Tab = { id, view: "issue", issueId };
  const panes = state.panes.map((p, i) => (i === idx ? { ...p, tabs: [...p.tabs, tab], activeTabId: id } : p));
  return { ...state, panes, focusedPaneId: paneId, seq: state.seq + 1 };
}

export function openIssueTabAcross(state: WorkspaceState, issueId: string): WorkspaceState {
  const found = findIssueTab(state, issueId);
  if (found) {
    const panes = state.panes.map((p, i) => (i === found.paneIdx ? { ...p, activeTabId: found.tabId } : p));
    return { ...state, panes, focusedPaneId: state.panes[found.paneIdx].id };
  }
  return addIssueTabIn(state, state.focusedPaneId, issueId);
}

export function openIssueInRightSplit(state: WorkspaceState, issueId: string): WorkspaceState {
  const found = findIssueTab(state, issueId);
  if (found) {
    // Already in the right pane → just focus/activate it there.
    if (state.panes.length === 2 && found.paneIdx === 1) {
      const panes = state.panes.map((p, i) => (i === 1 ? { ...p, activeTabId: found.tabId } : p));
      return { ...state, panes, focusedPaneId: state.panes[1].id };
    }
    // Sole issue tab in the only pane: cloning (splitTabRight) would duplicate the
    // issue and break workspace-wide dedup. Instead replace the left with a fresh
    // calendar tab and move the issue itself to a new right pane.
    const leftPane = state.panes[found.paneIdx];
    if (state.panes.length === 1 && leftPane.tabs.length === 1) {
      const issueTab = leftPane.tabs[0];
      const calId = `tab-${state.seq}`;
      const left: Pane = { ...leftPane, tabs: [{ id: calId, view: "calendar" }], activeTabId: calId };
      const right: Pane = { id: nextPaneId(state.panes), tabs: [issueTab], activeTabId: issueTab.id };
      return { ...state, panes: [left, right], focusedPaneId: right.id, seq: state.seq + 1 };
    }
    // Otherwise found in the left pane alongside other tabs → move it to the right.
    return splitTabRight(state, found.tabId);
  }
  // Not open anywhere → open a fresh issue tab in the right pane, leaving the left untouched.
  if (state.panes.length === 2) return addIssueTabIn(state, state.panes[1].id, issueId);
  const id = `tab-${state.seq}`;
  const right: Pane = { id: nextPaneId(state.panes), tabs: [{ id, view: "issue", issueId }], activeTabId: id };
  return { ...state, panes: [state.panes[0], right], focusedPaneId: right.id, seq: state.seq + 1 };
}

/** Throws if any global invariant is violated. Test-only guard. */
export function assertInvariants(state: WorkspaceState): void {
  if (state.panes.length < 1 || state.panes.length > 2) throw new Error("panes length out of range");
  const tabIds = new Set<string>();
  const paneIds = new Set<string>();
  for (const p of state.panes) {
    if (paneIds.has(p.id)) throw new Error(`duplicate pane id ${p.id}`);
    paneIds.add(p.id);
    if (p.tabs.length < 1) throw new Error(`empty pane ${p.id}`);
    if (!p.tabs.some((t) => t.id === p.activeTabId)) throw new Error(`active tab not in pane ${p.id}`);
    for (const t of p.tabs) {
      if (tabIds.has(t.id)) throw new Error(`duplicate tab id ${t.id}`);
      tabIds.add(t.id);
    }
  }
  if (!state.panes.some((p) => p.id === state.focusedPaneId)) throw new Error("focusedPaneId not a pane");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/paneModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck & commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/paneModel.ts src/lib/paneModel.test.ts
git commit -m "feat(split-view): pure pane reducers (split/move/swap/close/open)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Rewrite WorkspaceProvider over the pane model

**Files:**
- Modify: `src/lib/tabs.tsx` (replace body; re-export types from paneModel)
- Delete: `src/lib/tabs.test.ts` (its subjects `upsertIssueTab`/old `parsePersisted` moved to paneModel and changed shape)

**Interfaces:**
- Consumes: all Task 1–2 exports from `./paneModel`.
- Produces — `useWorkspace(): Ctx` where:

```ts
type Ctx = {
  panes: Pane[];
  focusedPaneId: string;
  ratio: number;
  tabs: Tab[];                       // focused pane's tabs (back-compat for the old TabBar, live until Task 6)
  active: Tab;                       // focused pane's active tab
  setActiveView: (view: ViewKind) => void;
  addTab: (view?: ViewKind) => void;             // focused pane
  addTabIn: (paneId: string, view?: ViewKind) => void;
  closeTab: (id: string) => void;
  selectTab: (id: string) => void;
  openIssueTab: (issueId: string) => void;       // dedupe across panes
  openIssueInRightSplit: (issueId: string) => void;
  splitTabRight: (tabId: string) => void;
  moveTabToOtherPane: (tabId: string) => void;
  swapPanes: () => void;
  focusPane: (paneId: string) => void;
  setRatio: (n: number) => void;
};
```

- Note: `Tab`, `ViewKind`, `Pane` are re-exported from `tabs.tsx` so existing `import { type ViewKind } from "@/lib/tabs"` keeps resolving. `tabs` is a derived convenience kept so the still-live `TabBar` compiles through Tasks 3–5; it's harmless after Task 6 deletes `TabBar`.

- [ ] **Step 1: Replace `src/lib/tabs.tsx`**

```tsx
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  parsePersisted, addTabIn as addTabInReducer, closeTabIn, selectTabIn,
  splitTabRight as splitTabRightReducer, moveTabToOtherPane as moveTabReducer,
  swapPanes as swapPanesReducer, openIssueTabAcross, openIssueInRightSplit as openRightReducer,
  type WorkspaceState, type Pane, type Tab, type ViewKind,
} from "./paneModel";

export type { ViewKind, Tab, Pane } from "./paneModel";

type Ctx = {
  panes: Pane[];
  focusedPaneId: string;
  ratio: number;
  tabs: Tab[];
  active: Tab;
  setActiveView: (view: ViewKind) => void;
  addTab: (view?: ViewKind) => void;
  addTabIn: (paneId: string, view?: ViewKind) => void;
  closeTab: (id: string) => void;
  selectTab: (id: string) => void;
  openIssueTab: (issueId: string) => void;
  openIssueInRightSplit: (issueId: string) => void;
  splitTabRight: (tabId: string) => void;
  moveTabToOtherPane: (tabId: string) => void;
  swapPanes: () => void;
  focusPane: (paneId: string) => void;
  setRatio: (n: number) => void;
};

const WorkspaceCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = "astryn.workspace";

function load(): WorkspaceState {
  try {
    return parsePersisted(localStorage.getItem(STORAGE_KEY));
  } catch {
    return parsePersisted(null);
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const initial = useRef<WorkspaceState | null>(null);
  if (!initial.current) initial.current = load();
  const [state, setState] = useState<WorkspaceState>(initial.current);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage unavailable / quota — keep in-memory state silently.
    }
  }, [state]);

  const focusedPane = state.panes.find((p) => p.id === state.focusedPaneId) ?? state.panes[0];
  const active = focusedPane.tabs.find((t) => t.id === focusedPane.activeTabId) ?? focusedPane.tabs[0];

  const setActiveView = (view: ViewKind) =>
    setState((s) => {
      const fp = s.panes.find((p) => p.id === s.focusedPaneId) ?? s.panes[0];
      const panes = s.panes.map((p) =>
        p.id === fp.id
          ? { ...p, tabs: p.tabs.map((t) => (t.id === fp.activeTabId ? { id: t.id, view } : t)) }
          : p,
      );
      return { ...s, panes };
    });

  const value: Ctx = {
    panes: state.panes,
    focusedPaneId: state.focusedPaneId,
    ratio: state.ratio,
    tabs: focusedPane.tabs,
    active,
    setActiveView,
    addTab: (view: ViewKind = "calendar") => setState((s) => addTabInReducer(s, s.focusedPaneId, view)),
    addTabIn: (paneId, view = "calendar") => setState((s) => addTabInReducer(s, paneId, view)),
    closeTab: (id) => setState((s) => closeTabIn(s, id)),
    selectTab: (id) => setState((s) => selectTabIn(s, id)),
    openIssueTab: (issueId) => setState((s) => openIssueTabAcross(s, issueId)),
    openIssueInRightSplit: (issueId) => setState((s) => openRightReducer(s, issueId)),
    splitTabRight: (tabId) => setState((s) => splitTabRightReducer(s, tabId)),
    moveTabToOtherPane: (tabId) => setState((s) => moveTabReducer(s, tabId)),
    swapPanes: () => setState((s) => swapPanesReducer(s)),
    focusPane: (paneId) => setState((s) => (s.focusedPaneId === paneId ? s : { ...s, focusedPaneId: paneId })),
    setRatio: (n) => setState((s) => (s.ratio === n ? s : { ...s, ratio: n })),
  };

  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export function useWorkspace(): Ctx {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
```

- [ ] **Step 2: Delete the obsolete pure-function test**

Run: `git rm src/lib/tabs.test.ts`
(Its `upsertIssueTab`/old-`parsePersisted` subjects moved to `paneModel` with new shapes; coverage now lives in `paneModel.test.ts`.)

- [ ] **Step 3: Verify no stale imports of removed exports**

Run: `rg -n "upsertIssueTab|parsePersisted" src` 
Expected: matches ONLY in `src/lib/paneModel.ts` and `src/lib/paneModel.test.ts`. If any other file references them, that file is in a later task — leave it; nothing should match here.

- [ ] **Step 4: Typecheck & run the suite**

Run: `npx tsc --noEmit`
Expected: no errors. `TabBar` (reads `tabs`/`active`/`selectTab`/`closeTab`/`addTab`), `Dock`, `IssueContextMenu`, `IssuePage`, `CommandPalette`, `AppShell` all still compile — every field/method they use is preserved on the new context (`tabs` is the focused pane's tabs).

Run: `npx vitest run`
Expected: PASS (existing suite + paneModel tests). `IssuePage.test.tsx` still passes — its `useWorkspace` mock returns `{ closeTab, active }`, both still present.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tabs.tsx
git commit -m "feat(split-view): back WorkspaceProvider with the pane model

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: IssuePage closes its own tab (explicit `tabId`)

**Files:**
- Modify: `src/features/drawer/IssuePage.tsx`
- Modify: `src/features/drawer/IssuePage.test.tsx`
- Modify: `src/components/AppShell.tsx:27` (pass `tabId`)

**Interfaces:**
- Consumes: `useWorkspace().closeTab` (Task 3).
- Produces: `IssuePage({ issueId, tabId }: { issueId: string; tabId: string })` — closes `tabId`, not the focused tab.

- [ ] **Step 1: Update the test to assert it closes the passed tabId**

Replace the body of `src/features/drawer/IssuePage.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { detail, closeTab } = vi.hoisted(() => ({ detail: { value: undefined as unknown }, closeTab: vi.fn() }));
vi.mock("@/lib/queries", () => ({ useIssueDetail: () => ({ data: detail.value }) }));
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ closeTab, active: { id: "tab-focused" } }) }));
vi.mock("./IssueDrawer", () => ({
  IssueDetail: ({ id, mode, onClose }: { id: string; mode: string; onClose: () => void }) => (
    <button data-testid="detail" onClick={onClose}>{`${mode}:${id}`}</button>
  ),
}));

import { IssuePage } from "./IssuePage";

afterEach(() => { cleanup(); detail.value = undefined; closeTab.mockReset(); });

describe("IssuePage", () => {
  it("shows a loading state until the detail resolves", () => {
    render(<IssuePage issueId="iss-1" tabId="tab-7" />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("renders IssueDetail in page mode once loaded", () => {
    detail.value = { source: "live", detail: {} };
    render(<IssuePage issueId="iss-1" tabId="tab-7" />);
    expect(screen.getByTestId("detail").textContent).toBe("page:iss-1");
  });

  it("closes its OWN tabId, not the focused tab", () => {
    detail.value = { source: "live", detail: {} };
    render(<IssuePage issueId="iss-1" tabId="tab-7" />);
    fireEvent.click(screen.getByTestId("detail"));
    expect(closeTab).toHaveBeenCalledWith("tab-7");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/drawer/IssuePage.test.tsx`
Expected: FAIL — `closeTab` called with `tab-focused` (current `active.id`) or type error on `tabId`.

- [ ] **Step 3: Update `IssuePage`**

Replace `src/features/drawer/IssuePage.tsx`:

```tsx
import { useIssueDetail } from "@/lib/queries";
import { useWorkspace } from "@/lib/tabs";
import { IssueDetail } from "./IssueDrawer";

/** Full-page issue view rendered in a workspace pane (an "issue" tab). */
export function IssuePage({ issueId, tabId }: { issueId: string; tabId: string }) {
  const { data: result } = useIssueDetail(issueId);
  const { closeTab } = useWorkspace();

  if (!result) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <IssueDetail id={issueId} result={result} mode="page" onClose={() => closeTab(tabId)} />
    </div>
  );
}
```

- [ ] **Step 4: Update the AppShell call site**

In `src/components/AppShell.tsx`, change the issue line:

```tsx
        {active.view === "issue" && active.issueId && <IssuePage issueId={active.issueId} tabId={active.id} />}
```

- [ ] **Step 5: Run tests & typecheck**

Run: `npx vitest run src/features/drawer/IssuePage.test.tsx && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/drawer/IssuePage.tsx src/features/drawer/IssuePage.test.tsx src/components/AppShell.tsx
git commit -m "feat(split-view): IssuePage closes its own tabId

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: PaneTabStrip + TabContextMenu

**Files:**
- Create: `src/components/PaneTabStrip.tsx`
- Create: `src/components/TabContextMenu.tsx`
- Test: `src/components/PaneTabStrip.test.tsx`

**Interfaces:**
- Consumes: `useWorkspace()` (Task 3), `useIssues` (`@/lib/queries`), `DualClock` (`@/features/home/DualClock`), `Pane`/`Tab` types.
- Produces:
  - `const TAB_DND_TYPE = "application/x-astryn-tab"` (exported from `PaneTabStrip.tsx`)
  - `PaneTabStrip({ pane, focused, showClock, canClose, isSplit }: { pane: Pane; focused: boolean; showClock: boolean; canClose: boolean; isSplit: boolean })`
  - `TabContextMenu({ tabId, isSplit, canClose, x, y, onClose }: { tabId: string; isSplit: boolean; canClose: boolean; x: number; y: number; onClose: () => void })`

- [ ] **Step 1: Write the failing test**

Create `src/components/PaneTabStrip.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const ws = vi.hoisted(() => ({
  addTabIn: vi.fn(), closeTab: vi.fn(), selectTab: vi.fn(), focusPane: vi.fn(),
  splitTabRight: vi.fn(), moveTabToOtherPane: vi.fn(), swapPanes: vi.fn(),
}));
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ws }));
vi.mock("@/lib/queries", () => ({ useIssues: () => ({ data: [] }) }));
vi.mock("@/features/home/DualClock", () => ({ DualClock: () => <div data-testid="clock" /> }));

import { PaneTabStrip } from "./PaneTabStrip";

const pane = { id: "pane-1", tabs: [{ id: "tab-3", view: "list" as const }], activeTabId: "tab-3" };

afterEach(() => {
  cleanup();
  Object.values(ws).forEach((fn) => fn.mockReset());
});

describe("PaneTabStrip", () => {
  it("the pane-local + adds a tab to THIS pane, not the focused one", () => {
    render(<PaneTabStrip pane={pane} focused={false} showClock={false} canClose={false} isSplit={true} />);
    fireEvent.click(screen.getByLabelText("New tab"));
    expect(ws.addTabIn).toHaveBeenCalledWith("pane-1");
  });

  it("shows the clock only when showClock is true", () => {
    const { rerender } = render(<PaneTabStrip pane={pane} focused={false} showClock={false} canClose={false} isSplit={true} />);
    expect(screen.queryByTestId("clock")).toBeNull();
    rerender(<PaneTabStrip pane={pane} focused={false} showClock={true} canClose={false} isSplit={true} />);
    expect(screen.getByTestId("clock")).toBeTruthy();
  });

  it("closing a tab calls closeTab with that tab id", () => {
    render(<PaneTabStrip pane={pane} focused={false} showClock={false} canClose={true} isSplit={true} />);
    fireEvent.click(screen.getByLabelText("Close tab"));
    expect(ws.closeTab).toHaveBeenCalledWith("tab-3");
  });

  it("dropping another pane's tab on this strip moves it here; own tab is a no-op", () => {
    const { container } = render(<PaneTabStrip pane={pane} focused={false} showClock={false} canClose={true} isSplit={true} />);
    const strip = container.firstChild as HTMLElement;
    const dt = (id: string) => ({ getData: () => id, types: ["application/x-astryn-tab"] });
    fireEvent.drop(strip, { dataTransfer: dt("tab-other") });
    expect(ws.moveTabToOtherPane).toHaveBeenCalledWith("tab-other");
    ws.moveTabToOtherPane.mockReset();
    fireEvent.drop(strip, { dataTransfer: dt("tab-3") }); // already in this pane
    expect(ws.moveTabToOtherPane).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/PaneTabStrip.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `TabContextMenu`**

Create `src/components/TabContextMenu.tsx`:

```tsx
import { useEffect, type ReactNode } from "react";
import { ArrowLeftRight, PanelRight, SquareSplitHorizontal, X } from "lucide-react";
import { useWorkspace } from "@/lib/tabs";

function Row({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-accent"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

export function TabContextMenu({
  tabId,
  isSplit,
  canClose,
  x,
  y,
  onClose,
}: {
  tabId: string;
  isSplit: boolean;
  canClose: boolean;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const { splitTabRight, moveTabToOtherPane, swapPanes, closeTab } = useWorkspace();

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const left = Math.min(x, window.innerWidth - 188);
  const top = Math.min(y, window.innerHeight - 160);

  return (
    <div
      data-command-shortcut-blocker
      onClick={(e) => e.stopPropagation()}
      className="fixed z-50 w-44 rounded-lg border border-border bg-popover p-1 text-foreground shadow-2xl"
      style={{ left, top }}
    >
      {!isSplit && (
        <Row icon={<SquareSplitHorizontal className="size-4" />} label="Open in split (right)" onClick={act(() => splitTabRight(tabId))} />
      )}
      {isSplit && (
        <>
          <Row icon={<PanelRight className="size-4" />} label="Move to other pane" onClick={act(() => moveTabToOtherPane(tabId))} />
          <Row icon={<ArrowLeftRight className="size-4" />} label="Swap panes" onClick={act(() => swapPanes())} />
        </>
      )}
      {canClose && (
        <>
          <div className="my-1 border-t border-border/60" />
          <Row icon={<X className="size-4" />} label="Close" onClick={act(() => closeTab(tabId))} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `PaneTabStrip`**

Create `src/components/PaneTabStrip.tsx`:

```tsx
import { useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import { Calendar, FileText, Inbox, List, Plus, Settings as SettingsIcon, X } from "lucide-react";
import { useWorkspace, type Pane, type ViewKind } from "@/lib/tabs";
import { useIssues } from "@/lib/queries";
import { DualClock } from "@/features/home/DualClock";
import { TabContextMenu } from "./TabContextMenu";

export const TAB_DND_TYPE = "application/x-astryn-tab";

const META: Record<Exclude<ViewKind, "issue">, { label: string; icon: ReactNode }> = {
  calendar: { label: "Calendar", icon: <Calendar className="size-3.5" /> },
  list: { label: "Issues", icon: <List className="size-3.5" /> },
  inbox: { label: "Inbox", icon: <Inbox className="size-3.5" /> },
  settings: { label: "Settings", icon: <SettingsIcon className="size-3.5" /> },
};

export function PaneTabStrip({
  pane,
  focused,
  showClock,
  canClose,
  isSplit,
}: {
  pane: Pane;
  focused: boolean;
  showClock: boolean;
  canClose: boolean;
  isSplit: boolean;
}) {
  const { selectTab, closeTab, addTabIn, focusPane, moveTabToOtherPane } = useWorkspace();
  const { data: issues } = useIssues({});
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);

  const onDragStart = (e: DragEvent, tabId: string) => {
    e.dataTransfer.setData(TAB_DND_TYPE, tabId);
    e.dataTransfer.effectAllowed = "move";
  };

  // Dropping a tab from the OTHER pane onto this strip moves it here.
  const onStripDrop = (e: DragEvent) => {
    e.preventDefault();
    const tabId = e.dataTransfer.getData(TAB_DND_TYPE);
    if (!tabId || pane.tabs.some((t) => t.id === tabId)) return; // own tab → no-op
    moveTabToOtherPane(tabId);
  };

  const openMenu = (e: MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ tabId, x: e.clientX, y: e.clientY });
  };

  return (
    <div
      onMouseDown={() => focusPane(pane.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onStripDrop}
      className={`flex items-center gap-1 border-b bg-background px-2 py-1.5 ${
        focused ? "border-b-border" : "border-b-border/60"
      }`}
    >
      {focused && <span className="mr-0.5 h-4 w-0.5 shrink-0 rounded-full bg-primary" aria-hidden />}
      {pane.tabs.map((t) => {
        const isActive = t.id === pane.activeTabId;
        const issue = t.view === "issue" ? (issues ?? []).find((i) => i.id === t.issueId) : undefined;
        const label = t.view === "issue" ? issue?.identifier ?? "Issue" : META[t.view].label;
        const icon = t.view === "issue" ? <FileText className="size-3.5" /> : META[t.view].icon;
        return (
          <div
            key={t.id}
            draggable
            onDragStart={(e) => onDragStart(e, t.id)}
            onClick={() => selectTab(t.id)}
            onContextMenu={(e) => openMenu(e, t.id)}
            className={`group flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
              isActive ? "bg-card text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
          >
            <span className="text-muted-foreground">{icon}</span>
            <span>{label}</span>
            {canClose && (
              <button
                type="button"
                aria-label="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                className="ml-1 cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        aria-label="New tab"
        onClick={() => addTabIn(pane.id)}
        className="ml-1 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Plus className="size-4" />
      </button>
      {showClock && (
        <div className="ml-auto">
          <DualClock compact />
        </div>
      )}
      {menu && <TabContextMenu tabId={menu.tabId} isSplit={isSplit} canClose={canClose} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  );
}
```

- [ ] **Step 5: Run tests & typecheck**

Run: `npx vitest run src/components/PaneTabStrip.test.tsx && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/PaneTabStrip.tsx src/components/TabContextMenu.tsx src/components/PaneTabStrip.test.tsx
git commit -m "feat(split-view): per-pane tab strip + tab context menu

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: SplitLayout — render panes, resize, swap, drop-to-split

**Files:**
- Create: `src/components/SplitLayout.tsx`
- Test: `src/components/SplitLayout.test.tsx`
- Modify: `src/components/AppShell.tsx` (render `SplitLayout`, drop `TabBar` + `<main>` switch)
- Delete: `src/components/TabBar.tsx`
- Modify: `src-tauri/tauri.conf.json` (window `minWidth`/`minHeight`)

**Interfaces:**
- Consumes: `useWorkspace()` (Task 3), `PaneTabStrip` + `TAB_DND_TYPE` (Task 5), `clampRatio`/`MIN_PANE_PX` (`@/lib/paneModel`), `IssuePage` (Task 4), feature views.
- Produces: `SplitLayout()` — the entire workspace body (strips + contents + divider). No props.

- [ ] **Step 1: Write the failing test**

Create `src/components/SplitLayout.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// jsdom has no ResizeObserver; SplitLayout constructs one when split.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const ws = vi.hoisted(() => ({
  panes: [
    { id: "pane-0", tabs: [{ id: "tab-0", view: "calendar" }], activeTabId: "tab-0" },
    { id: "pane-1", tabs: [{ id: "tab-1", view: "list" }], activeTabId: "tab-1" },
  ],
  focusedPaneId: "pane-0",
  ratio: 0.5,
  splitTabRight: vi.fn(),
  swapPanes: vi.fn(),
  setRatio: vi.fn(),
}));
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ws }));
vi.mock("./PaneTabStrip", () => ({
  TAB_DND_TYPE: "application/x-astryn-tab",
  PaneTabStrip: ({ pane }: { pane: { id: string } }) => <div data-testid={`strip-${pane.id}`} />,
}));
vi.mock("@/features/calendar/CalendarPage", () => ({ CalendarPage: () => <div>cal</div> }));
vi.mock("@/features/issues/IssuesView", () => ({ IssuesView: () => <div>list</div> }));
vi.mock("@/features/inbox/InboxView", () => ({ InboxView: () => <div>inbox</div> }));
vi.mock("@/features/settings/Settings", () => ({ Settings: () => <div>settings</div> }));
vi.mock("@/features/drawer/IssuePage", () => ({ IssuePage: () => <div>issue</div> }));

import { SplitLayout } from "./SplitLayout";

afterEach(() => { cleanup(); ws.splitTabRight.mockReset(); ws.swapPanes.mockReset(); ws.setRatio.mockReset(); });

describe("SplitLayout", () => {
  it("renders a strip per pane and the swap button when split", () => {
    render(<SplitLayout />);
    expect(screen.getByTestId("strip-pane-0")).toBeTruthy();
    expect(screen.getByTestId("strip-pane-1")).toBeTruthy();
    expect(screen.getByLabelText("Swap panes")).toBeTruthy();
  });

  it("dropping a tab on the right-half overlay calls splitTabRight with the dragged id", () => {
    render(<SplitLayout />);
    const dataTransfer = { getData: (t: string) => (t === "application/x-astryn-tab" ? "tab-0" : ""), types: ["application/x-astryn-tab"] };
    // A tab drag must be in progress for the overlay to render; SplitLayout listens on window.
    fireEvent.dragStart(screen.getByTestId("strip-pane-0"), { dataTransfer });
    const overlay = screen.getByTestId("right-drop-zone");
    fireEvent.drop(overlay, { dataTransfer });
    expect(ws.splitTabRight).toHaveBeenCalledWith("tab-0");
  });

  it("ArrowRight on the divider nudges the ratio up", () => {
    render(<SplitLayout />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
    expect(ws.setRatio).toHaveBeenCalled();
  });

  it("pointer-drag updates the ratio and removes listeners on pointer up", () => {
    render(<SplitLayout />);
    fireEvent.pointerDown(screen.getByRole("separator"));
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 100 }));
    expect(ws.setRatio).toHaveBeenCalled();
    ws.setRatio.mockReset();
    window.dispatchEvent(new MouseEvent("pointerup"));
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 200 }));
    expect(ws.setRatio).not.toHaveBeenCalled(); // listener torn down
  });

  it("removes drag listeners when unmounted mid-drag", () => {
    const { unmount } = render(<SplitLayout />);
    fireEvent.pointerDown(screen.getByRole("separator"));
    unmount();
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 100 }));
    expect(ws.setRatio).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/SplitLayout.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `SplitLayout`**

Create `src/components/SplitLayout.tsx`:

```tsx
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowLeftRight } from "lucide-react";
import { useWorkspace, type Tab } from "@/lib/tabs";
import { clampRatio, MIN_PANE_PX } from "@/lib/paneModel";
import { PaneTabStrip, TAB_DND_TYPE } from "./PaneTabStrip";
import { CalendarPage } from "@/features/calendar/CalendarPage";
import { IssuesView } from "@/features/issues/IssuesView";
import { InboxView } from "@/features/inbox/InboxView";
import { Settings } from "@/features/settings/Settings";
import { IssuePage } from "@/features/drawer/IssuePage";

const DIVIDER_PX = 6;
const STEP = 0.02;

function PaneContent({ tab }: { tab: Tab }) {
  switch (tab.view) {
    case "calendar":
      return <CalendarPage />;
    case "list":
      return <IssuesView />;
    case "inbox":
      return <InboxView />;
    case "settings":
      return <Settings />;
    case "issue":
      return tab.issueId ? <IssuePage issueId={tab.issueId} tabId={tab.id} /> : null;
  }
}

export function SplitLayout() {
  const { panes, focusedPaneId, ratio, splitTabRight, swapPanes, setRatio, focusPane } = useWorkspace();
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const isSplit = panes.length === 2;

  // Reflect any tab drag (from a PaneTabStrip) so the right-half drop overlay shows.
  useEffect(() => {
    const onStart = (e: globalThis.DragEvent) => {
      if (e.dataTransfer?.types.includes(TAB_DND_TYPE)) setDragActive(true);
    };
    const clear = () => setDragActive(false);
    window.addEventListener("dragstart", onStart);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragstart", onStart);
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, []);

  // Re-clamp the ratio when the container width changes so no pane strands below the minimum.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isSplit) return;
    const ro = new ResizeObserver(() => {
      const usable = el.clientWidth - DIVIDER_PX;
      const next = clampRatio(ratio, usable, MIN_PANE_PX);
      if (next !== ratio) setRatio(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isSplit, ratio, setRatio]);

  // Tear down any in-flight resize drag if the component unmounts mid-drag.
  useEffect(() => () => resizeCleanup.current?.(), []);

  const startResize = (e: PointerEvent) => {
    e.preventDefault();
    const move = (ev: globalThis.PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const usable = rect.width - DIVIDER_PX;
      setRatio(clampRatio((ev.clientX - rect.left) / usable, usable, MIN_PANE_PX));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      resizeCleanup.current = null;
    };
    resizeCleanup.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const onDividerKey = (e: KeyboardEvent) => {
    const usable = (containerRef.current?.clientWidth ?? 1000) - DIVIDER_PX;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setRatio(clampRatio(ratio - STEP, usable, MIN_PANE_PX));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setRatio(clampRatio(ratio + STEP, usable, MIN_PANE_PX));
    }
  };

  const onRightDrop = (e: DragEvent) => {
    e.preventDefault();
    const tabId = e.dataTransfer.getData(TAB_DND_TYPE);
    setDragActive(false);
    if (tabId) splitTabRight(tabId);
  };

  return (
    <div ref={containerRef} className="relative flex min-h-0 flex-1">
      {panes.map((pane, idx) => {
        const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0];
        const basis = !isSplit ? 100 : idx === 0 ? ratio * 100 : (1 - ratio) * 100;
        return (
          <div
            key={pane.id}
            onMouseDown={() => focusPane(pane.id)}
            className="flex min-w-0 flex-col"
            style={{ flexBasis: `${basis}%` }}
          >
            <PaneTabStrip
              pane={pane}
              focused={isSplit && pane.id === focusedPaneId}
              showClock={idx === panes.length - 1}
              canClose={pane.tabs.length > 1 || isSplit}
              isSplit={isSplit}
            />
            <div key={pane.activeTabId} className="min-h-0 flex-1 overflow-hidden">
              <PaneContent tab={activeTab} />
            </div>
          </div>
        );
      })}

      {isSplit && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={Math.round((MIN_PANE_PX / ((containerRef.current?.clientWidth ?? 1000) - DIVIDER_PX)) * 100)}
          aria-valuemax={100 - Math.round((MIN_PANE_PX / ((containerRef.current?.clientWidth ?? 1000) - DIVIDER_PX)) * 100)}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={onDividerKey}
          className="group absolute top-0 bottom-0 z-10 flex w-1.5 -translate-x-1/2 cursor-col-resize items-center justify-center bg-border/60 outline-none hover:bg-primary/40 focus-visible:bg-primary/60"
          style={{ left: `${ratio * 100}%` }}
        >
          <button
            type="button"
            aria-label="Swap panes"
            onClick={(e) => {
              e.stopPropagation();
              swapPanes();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="pointer-events-auto flex size-6 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground opacity-0 shadow transition-opacity hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
          >
            <ArrowLeftRight className="size-3.5" />
          </button>
        </div>
      )}

      {dragActive && (
        <div
          data-testid="right-drop-zone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onRightDrop}
          className="absolute inset-y-0 right-0 z-20 w-1/2 border-l-2 border-primary/60 bg-primary/10"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the SplitLayout test**

Run: `npx vitest run src/components/SplitLayout.test.tsx`
Expected: PASS.

- [ ] **Step 5: Swap `SplitLayout` into AppShell and delete `TabBar`**

Replace `src/components/AppShell.tsx`:

```tsx
import { useSyncLoop } from "@/lib/queries";
import { WorkspaceProvider } from "@/lib/tabs";
import { SplitLayout } from "@/components/SplitLayout";
import { Dock } from "@/components/Dock";
import { IssueDrawer } from "@/features/drawer/IssueDrawer";
import { IssueMenuProvider } from "@/features/issues/IssueContextMenu";
import { CommandPaletteProvider } from "@/features/command/CommandPalette";

function Shell() {
  const { isSyncing, refresh } = useSyncLoop();

  return (
    <div className="relative flex h-screen flex-col bg-background text-foreground">
      <SplitLayout />
      <Dock isSyncing={isSyncing} refresh={refresh} />
      <IssueDrawer />
    </div>
  );
}

export function AppShell() {
  return (
    <WorkspaceProvider>
      <IssueMenuProvider>
        <CommandPaletteProvider>
          <Shell />
        </CommandPaletteProvider>
      </IssueMenuProvider>
    </WorkspaceProvider>
  );
}
```

Then delete the now-unused global tab bar:

Run: `git rm src/components/TabBar.tsx`

- [ ] **Step 6: Add the window minimum size**

In `src-tauri/tauri.conf.json`, the `app.windows[0]` object currently is:

```json
      {
        "title": "Astryn",
        "width": 1280,
        "height": 800
      }
```

Change it to:

```json
      {
        "title": "Astryn",
        "width": 1280,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600
      }
```

- [ ] **Step 7: Verify nothing still imports TabBar, then typecheck & full suite**

Run: `rg -n "components/TabBar|\\bTabBar\\b" src`
Expected: no matches.

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; full suite PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/SplitLayout.tsx src/components/SplitLayout.test.tsx src/components/AppShell.tsx src-tauri/tauri.conf.json
git commit -m "feat(split-view): SplitLayout with resizable divider, swap & drop-to-split

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: "Open in right split" in the issue context menu

**Files:**
- Modify: `src/features/issues/IssueContextMenu.tsx`

**Interfaces:**
- Consumes: `useWorkspace().openIssueInRightSplit` (Task 3).
- Produces: a new menu row that calls `openIssueInRightSplit(issue.id)`.

- [ ] **Step 1: Import the icon and pull the method from context**

In `src/features/issues/IssueContextMenu.tsx`, add `SquareSplitHorizontal` to the existing `lucide-react` import (alphabetical, near `SignalHigh`):

```tsx
  SignalHigh,
  SquareSplitHorizontal,
  Tag,
```

Change the workspace destructure (currently `const { openIssueTab } = useWorkspace();`) to:

```tsx
  const { openIssueTab, openIssueInRightSplit } = useWorkspace();
```

- [ ] **Step 2: Add the row next to "Open in full page"**

After the existing "Open in full page" `Row` (the one with `Maximize2` calling `openIssueTab(issue.id)`), add:

```tsx
      {/* Open in the right split pane */}
      <Row
        icon={<SquareSplitHorizontal className="size-4" />}
        label="Open in right split"
        onMouseEnter={() => setSub(null)}
        onClick={() => {
          openIssueInRightSplit(issue.id);
          onClose();
        }}
      />
```

- [ ] **Step 3: Typecheck & build the frontend**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/issues/IssueContextMenu.tsx
git commit -m "feat(split-view): 'Open in right split' issue context-menu action

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Command-palette "Open issue in right split" sub-mode

**Files:**
- Modify: `src/features/command/CommandPalette.tsx`
- Test: `src/features/command/CommandPalette.test.tsx`

**Interfaces:**
- Consumes: `useWorkspace().openIssueInRightSplit` (Task 3).
- Produces: a command that switches the palette into an issue-only `target: "rightSplit"` mode; selecting an issue routes there; first `Esc` returns to normal mode.

- [ ] **Step 1: Write the failing test**

Create `src/features/command/CommandPalette.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const ws = vi.hoisted(() => ({ openIssueInRightSplit: vi.fn() }));
const setParams = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ws }));
vi.mock("@/lib/queries", () => ({
  invalidateWorkspaceQueries: vi.fn(),
  useIssues: () => ({ data: [{ id: "iss-1", identifier: "AB-1", title: "First", url: "u", stateColor: "#fff", labels: [] }] }),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn(), useSearchParams: () => [new URLSearchParams(), setParams] }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./CreateIssueModal", () => ({ CreateIssueModal: () => null }));

import { CommandPaletteProvider, useCommandPalette } from "./CommandPalette";

function Opener() {
  const { openPalette } = useCommandPalette();
  return <button onClick={openPalette}>open</button>;
}

afterEach(() => { cleanup(); ws.openIssueInRightSplit.mockReset(); setParams.mockReset(); });

function openPalette() {
  render(
    <CommandPaletteProvider>
      <Opener />
    </CommandPaletteProvider>,
  );
  fireEvent.click(screen.getByText("open"));
}

describe("CommandPalette right-split sub-mode", () => {
  it("routes a picked issue to openIssueInRightSplit after choosing the command", () => {
    openPalette();
    fireEvent.click(screen.getByText("Open issue in right split"));
    fireEvent.click(screen.getByText("First"));
    expect(ws.openIssueInRightSplit).toHaveBeenCalledWith("iss-1");
    expect(setParams).not.toHaveBeenCalled(); // did NOT open the drawer
  });

  it("first Escape exits the sub-mode without closing the palette", () => {
    openPalette();
    fireEvent.click(screen.getByText("Open issue in right split"));
    const input = screen.getByPlaceholderText(/pick an issue/i);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByPlaceholderText(/type a command/i)).toBeTruthy(); // back to normal mode
  });

  it("the visible Back control exits the sub-mode", () => {
    openPalette();
    fireEvent.click(screen.getByText("Open issue in right split"));
    fireEvent.click(screen.getByLabelText("Back"));
    expect(screen.getByPlaceholderText(/type a command/i)).toBeTruthy();
  });

  it("a second Escape closes the palette", () => {
    openPalette();
    fireEvent.click(screen.getByText("Open issue in right split"));
    fireEvent.keyDown(screen.getByPlaceholderText(/pick an issue/i), { key: "Escape" }); // -> normal mode
    fireEvent.keyDown(screen.getByPlaceholderText(/type a command/i), { key: "Escape" }); // -> closed
    expect(screen.queryByPlaceholderText(/type a command/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/command/CommandPalette.test.tsx`
Expected: FAIL — no "Open issue in right split" command / placeholder.

- [ ] **Step 3: Wire the command, target state, sub-mode placeholder, routing, and Escape**

In `src/features/command/CommandPalette.tsx`:

(a) Add `SquareSplitHorizontal` to the `lucide-react` import list.

(b) Import the workspace hook — add near the other imports:

```tsx
import { useWorkspace } from "@/lib/tabs";
```

(c) Inside `Palette`, add the target state and the workspace method (after `const [q, setQ] = useState("");`):

```tsx
  const { openIssueInRightSplit } = useWorkspace();
  const [target, setTarget] = useState<"drawer" | "rightSplit">("drawer");
```

(d) Replace `openIssue` so it honors the target:

```tsx
  const openIssue = (id: string) => {
    if (target === "rightSplit") openIssueInRightSplit(id);
    else setParams({ issue: id });
    onClose();
  };
```

(e) Add the command to the `commands` array (after the `create` entry):

```tsx
      { key: "split-right", section: "Navigation", icon: <SquareSplitHorizontal className="size-4" />, label: "Open issue in right split", onSelect: () => { setTarget("rightSplit"); setQ(""); } },
```

(f) In sub-mode, hide commands and show only issues. Replace `const filteredCommands = ...` with:

```tsx
  const filteredCommands = target === "rightSplit"
    ? []
    : term
      ? commands.filter((c) => c.label.toLowerCase().includes(term))
      : commands;
```

(g) Make the input placeholder reflect the mode. Change the `<input ... placeholder="Type a command or search…" />` to:

```tsx
            placeholder={target === "rightSplit" ? "Open in right split — pick an issue…" : "Type a command or search…"}
```

(h) First Escape exits sub-mode; a second closes. In `onKey`, replace the `Escape` branch:

```tsx
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (target === "rightSplit") {
        setTarget("drawer");
        setQ("");
      } else {
        onClose();
      }
    }
```

(i) Add a visible Back control for the sub-mode (the spec says "Esc/**back**"). In the header, replace `<Search className="size-4 shrink-0 text-muted-foreground" />` with:

```tsx
          {target === "rightSplit" ? (
            <button
              type="button"
              aria-label="Back"
              onClick={() => {
                setTarget("drawer");
                setQ("");
              }}
              className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </button>
          ) : (
            <Search className="size-4 shrink-0 text-muted-foreground" />
          )}
```

(`ArrowLeft` is already imported for the "Go back" command.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/command/CommandPalette.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck & full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; full suite PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/command/CommandPalette.tsx src/features/command/CommandPalette.test.tsx
git commit -m "feat(split-view): command-palette 'open issue in right split' sub-mode

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Final gates + manual verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run every gate**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: type-clean; all tests pass; `vite build` succeeds.

Run: `cargo test --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
Expected: green (the only Rust-side change is the JSON config; tests/clippy/fmt unaffected).

- [ ] **Step 2: Manual smoke test in the desktop app**

Run: `npm run tauri dev`, then verify each behavior:

- [ ] From the default single calendar tab: right-click the tab → **Open in split (right)** → a second pane appears with a calendar clone; the original stays on the left.
- [ ] Drag a tab into the **right half** of the body → the right-half overlay highlights → dropping splits/moves it right. Dragging a right-pane tab onto the right half does nothing (no-op).
- [ ] Drag the **divider** to resize; neither pane shrinks below ~320px; release cleanly (no further movement after pointer-up).
- [ ] Focus the divider with Tab; **ArrowLeft/ArrowRight** resize by a step; the **⇄ swap button** appears and swaps the panes.
- [ ] Right-click an issue row → **Open in right split** opens that issue in the right pane, left untouched.
- [ ] `Cmd/Ctrl+K` → **Open issue in right split** → placeholder changes → pick an issue → it opens in the right pane; first `Esc` returns to normal palette mode.
- [ ] Close the last tab of a pane → the split collapses to a single full-width pane.
- [ ] Reload the app (Cmd+R) → the split layout, active tabs, and ratio persist.
- [ ] Migration: in devtools run `localStorage.setItem('astryn.workspace', JSON.stringify({tabs:[{id:'tab-0',view:'calendar'}],activeId:'tab-0',seq:1}))`, reload → opens as a single pane with the calendar tab (no crash).

- [ ] **Step 3: Update CLAUDE.md status if appropriate** (optional)

If the team tracks milestone status in `CLAUDE.md`, note that split-view (the final M1 feature) is complete. Otherwise skip.

- [ ] **Step 4: Final commit (only if Step 3 changed anything)**

```bash
git add -A
git commit -m "docs: mark split-view (M1 final) complete

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
