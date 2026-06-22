import { describe, it, expect } from "vitest";
import { buildHeatmap, statusBreakdown, priorityBreakdown, agendaCounts } from "./agendaStats";
import type { AgendaGroup, AgendaItem } from "./agenda";
import type { IssueListItem } from "../../lib/commands";

/** Minimal fixture factory — only fills in fields the functions under test read. */
function iss(over: Partial<IssueListItem> & { id: string }): IssueListItem {
  return {
    identifier: over.identifier ?? `ENG-${over.id}`,
    title: over.title ?? "T",
    description: null,
    dueDate: over.dueDate ?? null,
    startedAt: over.startedAt ?? null,
    priority: over.priority ?? 0,
    url: "u",
    stateId: null,
    stateName: over.stateName ?? "Todo",
    stateType: over.stateType ?? "unstarted",
    stateColor: over.stateColor ?? "#fff",
    assigneeId: over.assigneeId ?? "me",
    assigneeName: "Me",
    teamId: null,
    teamKey: null,
    projectId: null,
    projectName: null,
    parentId: over.parentId ?? null,
    estimate: null,
    cycleName: null,
    cycleNumber: null,
    milestoneName: null,
    linkCount: 0,
    prCount: 0,
    attachmentsTruncated: false,
    createdAt: "c",
    updatedAt: "u",
    labels: [],
    ...over,
  };
}

// Anchor: 2026-06-24 (Wed, Dhaka) → current Sunday-week starts 2026-06-21.
const NOW = new Date("2026-06-24T06:00:00Z");

describe("buildHeatmap", () => {
  it("produces (weeksBack + 1 + weeksForward) weeks in oldest→newest order", () => {
    const weeks = buildHeatmap([], "me", { now: NOW, weeksBack: 2, weeksForward: 1 });
    // -2, -1, 0, +1 = 4 weeks
    expect(weeks).toHaveLength(4);
    expect(weeks.map((w) => w.offset)).toEqual([-2, -1, 0, 1]);
  });

  it("each week has exactly 7 cells", () => {
    const weeks = buildHeatmap([], "me", { now: NOW, weeksBack: 0, weeksForward: 0 });
    expect(weeks[0].cells).toHaveLength(7);
  });

  it("cells of the current week start on 2026-06-21 (Sun)", () => {
    const weeks = buildHeatmap([], "me", { now: NOW, weeksBack: 0, weeksForward: 0 });
    expect(weeks[0].cells[0].date).toBe("2026-06-21");
    expect(weeks[0].cells[6].date).toBe("2026-06-27");
  });

  it("counts the viewer's issues on the correct due date cell", () => {
    const issues = [
      iss({ id: "1", dueDate: "2026-06-24" }), // Wed of current week
      iss({ id: "2", dueDate: "2026-06-24" }), // same day, second issue
      iss({ id: "3", dueDate: "2026-06-22" }), // Mon of current week
    ];
    const weeks = buildHeatmap(issues, "me", { now: NOW, weeksBack: 0, weeksForward: 0 });
    const cells = weeks[0].cells;
    // Wed = day index 3 (Sun=0 … Sat=6)
    expect(cells[3]).toMatchObject({ date: "2026-06-24", count: 2 });
    // Mon = day index 1
    expect(cells[1]).toMatchObject({ date: "2026-06-22", count: 1 });
    // A day with no issues
    expect(cells[0]).toMatchObject({ date: "2026-06-21", count: 0 });
  });

  it("excludes issues belonging to other assignees", () => {
    const issues = [
      iss({ id: "1", dueDate: "2026-06-24", assigneeId: "someone-else" }),
    ];
    const weeks = buildHeatmap(issues, "me", { now: NOW, weeksBack: 0, weeksForward: 0 });
    expect(weeks[0].cells.every((c) => c.count === 0)).toBe(true);
  });

  it("excludes issues with no dueDate", () => {
    const issues = [iss({ id: "1", dueDate: null })];
    const weeks = buildHeatmap(issues, "me", { now: NOW, weeksBack: 0, weeksForward: 0 });
    expect(weeks[0].cells.every((c) => c.count === 0)).toBe(true);
  });

  it("places a past-week issue in the correct offset=-1 week", () => {
    // Previous week's Sunday = 2026-06-14
    const issues = [iss({ id: "1", dueDate: "2026-06-16" })]; // Tue of prev week
    const weeks = buildHeatmap(issues, "me", { now: NOW, weeksBack: 1, weeksForward: 0 });
    const prevWeek = weeks.find((w) => w.offset === -1)!;
    // Tue = day index 2
    expect(prevWeek.cells[2]).toMatchObject({ date: "2026-06-16", count: 1 });
  });
});

describe("statusBreakdown", () => {
  it("groups by stateType and counts correctly", () => {
    const items = [
      iss({ id: "1", stateType: "started", stateName: "In Progress", stateColor: "#00f" }),
      iss({ id: "2", stateType: "started", stateName: "In Progress", stateColor: "#00f" }),
      iss({ id: "3", stateType: "completed", stateName: "Done", stateColor: "#0f0" }),
    ];
    const result = statusBreakdown(items);
    const started = result.find((r) => r.type === "started")!;
    const completed = result.find((r) => r.type === "completed")!;
    expect(started.count).toBe(2);
    expect(completed.count).toBe(1);
  });

  it("uses stateName and stateColor from the first item in each group", () => {
    const items = [
      iss({ id: "1", stateType: "unstarted", stateName: "Todo", stateColor: "#aaa" }),
    ];
    const result = statusBreakdown(items);
    expect(result[0]).toMatchObject({ type: "unstarted", name: "Todo", color: "#aaa", count: 1 });
  });

  it("sorts by STATE_RANK: backlog < unstarted < started < completed < canceled", () => {
    const items = [
      iss({ id: "1", stateType: "canceled" }),
      iss({ id: "2", stateType: "started" }),
      iss({ id: "3", stateType: "backlog" }),
      iss({ id: "4", stateType: "completed" }),
      iss({ id: "5", stateType: "unstarted" }),
    ];
    const result = statusBreakdown(items);
    expect(result.map((r) => r.type)).toEqual([
      "backlog", "unstarted", "started", "completed", "canceled",
    ]);
  });

  it("places unknown state types last", () => {
    const items = [
      iss({ id: "1", stateType: "mystery" }),
      iss({ id: "2", stateType: "started" }),
    ];
    const result = statusBreakdown(items);
    expect(result[result.length - 1].type).toBe("mystery");
  });
});

describe("priorityBreakdown", () => {
  it("only includes buckets with ≥1 item", () => {
    const items = [
      iss({ id: "1", priority: 1 }), // Urgent
      iss({ id: "2", priority: 3 }), // Medium
    ];
    const result = priorityBreakdown(items);
    expect(result.map((r) => r.priority)).toEqual([1, 3]);
  });

  it("orders Urgent→High→Medium→Low→None", () => {
    const items = [
      iss({ id: "1", priority: 0 }), // None
      iss({ id: "2", priority: 4 }), // Low
      iss({ id: "3", priority: 2 }), // High
      iss({ id: "4", priority: 1 }), // Urgent
      iss({ id: "5", priority: 3 }), // Medium
    ];
    const result = priorityBreakdown(items);
    expect(result.map((r) => r.priority)).toEqual([1, 2, 3, 4, 0]);
  });

  it("attaches correct label and color for each priority", () => {
    const items = [iss({ id: "1", priority: 1 })];
    const [entry] = priorityBreakdown(items);
    expect(entry).toMatchObject({ priority: 1, label: "Urgent", color: "#ef4444", count: 1 });
  });

  it("counts multiple issues in the same bucket", () => {
    const items = [
      iss({ id: "1", priority: 2 }),
      iss({ id: "2", priority: 2 }),
      iss({ id: "3", priority: 2 }),
    ];
    const [entry] = priorityBreakdown(items);
    expect(entry.count).toBe(3);
  });
});

describe("agendaCounts", () => {
  const item = (over: Partial<IssueListItem> & { id: string }): AgendaItem => ({
    issue: iss(over),
    relations: [],
  });
  const group = (key: string, items: AgendaItem[]): AgendaGroup => ({
    key,
    label: key,
    date: null,
    items,
  });

  it("buckets by state: unstarted→todo, started→inProgress, review-named→inReview", () => {
    const groups = [
      group("2026-06-22", [
        item({ id: "1", stateType: "unstarted", stateName: "Todo" }),
        item({ id: "2", stateType: "started", stateName: "In Progress" }),
        item({ id: "3", stateType: "started", stateName: "In Review" }),
      ]),
    ];
    expect(agendaCounts(groups)).toEqual({ todo: 1, inProgress: 1, inReview: 1, overdue: 0 });
  });

  it("counts the Overdue group size and still buckets its items by state", () => {
    const groups = [
      group("overdue", [
        item({ id: "1", stateType: "started", stateName: "In Progress" }),
        item({ id: "2", stateType: "unstarted", stateName: "Todo" }),
      ]),
      group("2026-06-22", [item({ id: "3", stateType: "started", stateName: "In Progress" })]),
    ];
    expect(agendaCounts(groups)).toEqual({ todo: 1, inProgress: 2, inReview: 0, overdue: 2 });
  });

  it("ignores completed/canceled states (none of the four buckets)", () => {
    const groups = [
      group("2026-06-22", [
        item({ id: "1", stateType: "completed", stateName: "Done" }),
        item({ id: "2", stateType: "canceled", stateName: "Canceled" }),
        item({ id: "3", stateType: "backlog", stateName: "Backlog" }),
      ]),
    ];
    expect(agendaCounts(groups)).toEqual({ todo: 0, inProgress: 0, inReview: 0, overdue: 0 });
  });
});
