import { describe, expect, it } from "vitest";
import { upsertIssueTab, parsePersisted } from "./tabs";
import type { Tab } from "./tabs";

const base: Tab[] = [{ id: "tab-0", view: "calendar" }];

describe("upsertIssueTab", () => {
  it("creates and activates a new issue tab, incrementing seq", () => {
    const r = upsertIssueTab(base, "iss-1", 1);
    expect(r.tabs).toHaveLength(2);
    expect(r.tabs[1]).toEqual({ id: "tab-1", view: "issue", issueId: "iss-1" });
    expect(r.activeId).toBe("tab-1");
    expect(r.seq).toBe(2);
  });

  it("selects the existing tab when the issue is already open (no duplicate, seq unchanged)", () => {
    const tabs: Tab[] = [...base, { id: "tab-1", view: "issue", issueId: "iss-1" }];
    const r = upsertIssueTab(tabs, "iss-1", 2);
    expect(r.tabs).toHaveLength(2);
    expect(r.activeId).toBe("tab-1");
    expect(r.seq).toBe(2);
  });
});

describe("parsePersisted", () => {
  it("keeps a valid issue tab and drops an issue tab missing issueId", () => {
    const raw = JSON.stringify({
      tabs: [
        { id: "tab-0", view: "calendar" },
        { id: "tab-1", view: "issue", issueId: "iss-1" },
        { id: "tab-2", view: "issue" }, // invalid: no issueId
      ],
      activeId: "tab-1",
      seq: 3,
    });
    const p = parsePersisted(raw);
    expect(p.tabs.map((t) => t.id)).toEqual(["tab-0", "tab-1"]);
    expect(p.activeId).toBe("tab-1");
  });

  it("falls back for null/garbage input", () => {
    expect(parsePersisted(null).tabs).toHaveLength(1);
    expect(parsePersisted("{not json").tabs[0].view).toBe("calendar");
  });
});
