import { describe, expect, it } from "vitest";
import { parsePersisted, nextPaneId, clampRatio, FALLBACK, VIEWS } from "./paneModel";
import {
  addTabIn, closeTabIn, splitTabRight, moveTabToOtherPane, moveTab, swapPanes,
  selectTabIn, openIssueTabAcross, openIssueInRightSplit, assertInvariants,
  openDocTabAcross, openDocInRightSplit,
} from "./paneModel";
import type { Pane, WorkspaceState } from "./paneModel";

describe("VIEWS", () => {
  it("includes the slack view", () => {
    expect(VIEWS).toContain("slack");
  });
});

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

describe("moveTab", () => {
  it("reorders within the same pane", () => {
    const base = single();
    base.panes[0].tabs = [
      { id: "tab-0", view: "calendar" },
      { id: "tab-1", view: "list" },
      { id: "tab-2", view: "inbox" },
    ];
    base.panes[0].activeTabId = "tab-0";
    const s = moveTab(base, "tab-2", "pane-0", 0); // move tab-2 to the front
    expect(s.panes[0].tabs.map((t) => t.id)).toEqual(["tab-2", "tab-0", "tab-1"]);
    expect(s.panes[0].activeTabId).toBe("tab-2");
    assertInvariants(s);
  });
  it("inserts across panes at a precise index", () => {
    const base = split();
    base.panes[1].tabs = [{ id: "tab-1", view: "list" }, { id: "tab-2", view: "inbox" }];
    const s = moveTab(base, "tab-0", "pane-1", 1); // pane-0's only tab → pane-1 index 1
    // pane-0 emptied → collapses; survivor is pane-1 with tab-0 inserted at index 1
    expect(s.panes).toHaveLength(1);
    expect(s.panes[0].id).toBe("pane-1");
    expect(s.panes[0].tabs.map((t) => t.id)).toEqual(["tab-1", "tab-0", "tab-2"]);
    expect(s.panes[0].activeTabId).toBe("tab-0");
    assertInvariants(s);
  });
  it("no-ops for an unknown tab or pane", () => {
    const base = split();
    expect(moveTab(base, "nope", "pane-1", 0)).toBe(base);
    expect(moveTab(base, "tab-0", "pane-9", 0)).toBe(base);
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
  it("focuses the right copy (no collapse / no new duplicate) when the issue exists in both panes", () => {
    const s0: WorkspaceState = {
      panes: [
        { id: "pane-0", tabs: [{ id: "tab-0", view: "issue", issueId: "iss-1" }], activeTabId: "tab-0" },
        { id: "pane-1", tabs: [{ id: "tab-1", view: "issue", issueId: "iss-1" }], activeTabId: "tab-1" },
      ],
      focusedPaneId: "pane-0", ratio: 0.5, seq: 2,
    };
    const s = openIssueInRightSplit(s0, "iss-1");
    expect(s.panes).toHaveLength(2); // not collapsed
    expect(s.panes[0].tabs.map((t) => t.id)).toEqual(["tab-0"]); // left untouched
    expect(s.panes[1].activeTabId).toBe("tab-1"); // right copy focused
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

describe("openDocTabAcross / openDocInRightSplit", () => {
  it("openDocTabAcross adds a docs tab carrying the path to the focused pane", () => {
    const s = openDocTabAcross(single(), "02-technical/01-architecture.md");
    expect(s.panes[0].tabs[1]).toEqual({
      id: "tab-1",
      view: "docs",
      docPath: "02-technical/01-architecture.md",
    });
    expect(s.focusedPaneId).toBe("pane-0");
    assertInvariants(s);
  });
  it("openDocTabAcross focuses an existing tab for the same doc instead of duplicating", () => {
    const base = openDocTabAcross(single(), "a.md");
    const again = openDocTabAcross(base, "a.md");
    expect(again.panes.flatMap((p) => p.tabs).filter((t) => t.docPath === "a.md")).toHaveLength(1);
    expect(again.panes[0].activeTabId).toBe("tab-1");
  });
  it("openDocInRightSplit creates a right pane with the doc, leaving the left untouched", () => {
    const s = openDocInRightSplit(single(), "a.md");
    expect(s.panes[0].tabs.map((t) => t.id)).toEqual(["tab-0"]); // left unchanged
    expect(s.panes[1].tabs[0]).toEqual({ id: "tab-1", view: "docs", docPath: "a.md" });
    expect(s.focusedPaneId).toBe("pane-1");
    assertInvariants(s);
  });
  it("openDocInRightSplit reuses the right pane's existing tab for the same doc", () => {
    const base = openDocInRightSplit(single(), "a.md");
    const again = openDocInRightSplit(base, "a.md");
    expect(again.panes[1].tabs).toHaveLength(1);
    expect(again.panes[1].activeTabId).toBe("tab-1");
    expect(again.focusedPaneId).toBe("pane-1");
    assertInvariants(again);
  });
  it("openDocInRightSplit adds to the existing right pane when already split", () => {
    const s = openDocInRightSplit(split(), "a.md");
    expect(s.panes[1].tabs.map((t) => t.view)).toEqual(["list", "docs"]);
    expect(s.panes[1].tabs[1].docPath).toBe("a.md");
    assertInvariants(s);
  });
});
