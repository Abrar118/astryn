import { describe, it, expect } from "vitest";
import { matchesFilters, inRange, reconcileList, applyPatchToCalendarIssue, calendarIssueFromList } from "./optimistic";
import type { CalendarIssue, IssueListItem } from "./commands";

const mk = (id: string, dueDate: string | null, over: Partial<CalendarIssue> = {}): CalendarIssue => ({
  id, identifier: `ENG-${id}`, title: "T", dueDate, priority: 0,
  stateType: "unstarted", stateColor: "#fff", assigneeId: "me",
  teamId: "t1", teamKey: "ENG", projectId: "p1", ...over,
});

describe("matchesFilters", () => {
  it("matches when filter fields agree or are unset", () => {
    expect(matchesFilters(mk("1", null), {})).toBe(true);
    expect(matchesFilters(mk("1", null), { assigneeId: "me" })).toBe(true);
    expect(matchesFilters(mk("1", null), { assigneeId: "other" })).toBe(false);
    expect(matchesFilters(mk("1", null), { teamId: "t2" })).toBe(false);
    expect(matchesFilters(mk("1", null), { projectId: "p1" })).toBe(true);
  });
});

describe("inRange (half-open)", () => {
  it("includes start, excludes end, excludes null", () => {
    expect(inRange("2026-06-01", "2026-06-01", "2026-07-01")).toBe(true);
    expect(inRange("2026-07-01", "2026-06-01", "2026-07-01")).toBe(false);
    expect(inRange(null, "2026-06-01", "2026-07-01")).toBe(false);
  });
});

describe("reconcileList", () => {
  it("inserts when belongs, removes when not, updates in place", () => {
    const a = mk("1", "2026-06-10");
    expect(reconcileList([], a, true).map((i) => i.id)).toEqual(["1"]);
    expect(reconcileList([a], a, false)).toEqual([]);
    const moved = { ...a, dueDate: "2026-06-12" };
    const out = reconcileList([a], moved, true);
    expect(out).toHaveLength(1);
    expect(out[0].dueDate).toBe("2026-06-12");
  });
});

describe("applyPatchToCalendarIssue", () => {
  it("applies only the calendar-visible patch fields", () => {
    const out = applyPatchToCalendarIssue(mk("1", "2026-06-10"), { dueDate: null, priority: 2 });
    expect(out.dueDate).toBeNull();
    expect(out.priority).toBe(2);
    expect(out.title).toBe("T");
  });
});

describe("calendarIssueFromList", () => {
  it("provides a base that can be inserted into a newly matching calendar cache", () => {
    const listItem = {
      ...mk("1", null), stateId: "s1", stateName: "Todo", assigneeName: "Me",
      description: null, url: "u", projectName: null, parentId: null, estimate: null,
      cycleName: null, cycleNumber: null, milestoneName: null, linkCount: 0, prCount: 0,
      attachmentsTruncated: false,
      createdAt: "2026-06-18T20:30:00Z", updatedAt: "2026-06-18T20:30:00Z", labels: [],
    } satisfies IssueListItem;
    expect(calendarIssueFromList(listItem)).toEqual(mk("1", null));
  });
});
