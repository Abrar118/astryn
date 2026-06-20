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
