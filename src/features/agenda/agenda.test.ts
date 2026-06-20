import { describe, it, expect } from "vitest";
import { buildAgenda } from "./agenda";
import type { IssueListItem, Relation } from "../../lib/commands";
import type { WeekWindow } from "../../lib/dates";

const WINDOW: WeekWindow = {
  weekStart: "2026-06-21",
  weekEnd: "2026-06-28",
  weekdays: ["2026-06-21", "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25"],
  weekend: ["2026-06-26", "2026-06-27"],
};

function iss(over: Partial<IssueListItem> & { id: string }): IssueListItem {
  return {
    identifier: over.identifier ?? `ENG-${over.id}`,
    title: over.title ?? "T",
    description: null,
    dueDate: over.dueDate ?? null,
    priority: over.priority ?? 0,
    url: "u",
    stateId: null,
    stateName: over.stateName ?? "Todo",
    stateType: over.stateType ?? "unstarted",
    stateColor: "#fff",
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

const find = (gs: ReturnType<typeof buildAgenda>, key: string) =>
  gs.find((g) => g.key === key);

describe("buildAgenda", () => {
  it("buckets the viewer's issues by weekday and always renders Sun-Thu", () => {
    const issues = [iss({ id: "1", dueDate: "2026-06-22" })];
    const gs = buildAgenda({ issues, relations: [], viewerId: "me", window: WINDOW });
    expect(gs.filter((g) => g.date).map((g) => g.key)).toEqual(WINDOW.weekdays);
    expect(find(gs, "2026-06-22")!.items.map((i) => i.issue.id)).toEqual(["1"]);
    expect(find(gs, "2026-06-21")!.items).toEqual([]); // empty weekday still present
  });

  it("excludes other people's issues and undated issues", () => {
    const issues = [
      iss({ id: "1", dueDate: "2026-06-22", assigneeId: "someone" }),
      iss({ id: "2", dueDate: null }),
    ];
    const gs = buildAgenda({ issues, relations: [], viewerId: "me", window: WINDOW });
    expect(gs.flatMap((g) => g.items)).toEqual([]);
  });

  it("puts past-due open issues in Overdue but not completed/canceled ones", () => {
    const issues = [
      iss({ id: "1", dueDate: "2026-06-10", stateType: "started" }),
      iss({ id: "2", dueDate: "2026-06-10", stateType: "completed" }),
    ];
    const gs = buildAgenda({ issues, relations: [], viewerId: "me", window: WINDOW });
    expect(find(gs, "overdue")!.items.map((i) => i.issue.id)).toEqual(["1"]);
  });

  it("folds Friday/Saturday into a Weekend group only when non-empty", () => {
    const noWeekend = buildAgenda({
      issues: [iss({ id: "1", dueDate: "2026-06-22" })],
      relations: [], viewerId: "me", window: WINDOW,
    });
    expect(find(noWeekend, "weekend")).toBeUndefined();
    const withWeekend = buildAgenda({
      issues: [iss({ id: "2", dueDate: "2026-06-26" })],
      relations: [], viewerId: "me", window: WINDOW,
    });
    expect(find(withWeekend, "weekend")!.items.map((i) => i.issue.id)).toEqual(["2"]);
  });

  it("threads sub-issues and dedupes them from the top level", () => {
    const issues = [
      iss({ id: "p", dueDate: "2026-06-22" }),
      iss({ id: "c", dueDate: "2026-06-23", parentId: "p" }), // mine AND due this week
    ];
    const gs = buildAgenda({ issues, relations: [], viewerId: "me", window: WINDOW });
    expect(find(gs, "2026-06-22")!.items[0].children.map((c) => c.id)).toEqual(["c"]);
    expect(find(gs, "2026-06-23")!.items).toEqual([]); // 'c' not a standalone top-level row
  });

  it("attaches relations to their issue", () => {
    const rel: Relation = {
      issueId: "1", type: "blocks", relatedId: "9",
      relatedIdentifier: "ENG-9", relatedTitle: "Dep",
      relatedStateName: "Done", relatedStateType: "completed", relatedStateColor: "#0f0",
    };
    const gs = buildAgenda({
      issues: [iss({ id: "1", dueDate: "2026-06-22" })],
      relations: [rel], viewerId: "me", window: WINDOW,
    });
    expect(find(gs, "2026-06-22")!.items[0].relations).toEqual([rel]);
  });

  it("sorts within a day by priority then identifier", () => {
    const issues = [
      iss({ id: "a", identifier: "ENG-3", dueDate: "2026-06-22", priority: 0 }), // none -> last
      iss({ id: "b", identifier: "ENG-2", dueDate: "2026-06-22", priority: 1 }), // urgent -> first
      iss({ id: "c", identifier: "ENG-1", dueDate: "2026-06-22", priority: 1 }),
    ];
    const gs = buildAgenda({ issues, relations: [], viewerId: "me", window: WINDOW });
    expect(find(gs, "2026-06-22")!.items.map((i) => i.issue.identifier)).toEqual([
      "ENG-1", "ENG-2", "ENG-3",
    ]);
  });

  it("omits Overdue group when includeOverdue is false, even with past-due open issues", () => {
    const issues = [
      iss({ id: "1", dueDate: "2026-06-10", stateType: "started" }), // past-due open issue
      iss({ id: "2", dueDate: "2026-06-22" }), // normal weekday issue
    ];
    const gs = buildAgenda({ issues, relations: [], viewerId: "me", window: WINDOW, includeOverdue: false });
    expect(find(gs, "overdue")).toBeUndefined();
    // Weekday groups still present
    expect(gs.filter((g) => g.date).map((g) => g.key)).toEqual(WINDOW.weekdays);
    expect(find(gs, "2026-06-22")!.items.map((i) => i.issue.id)).toEqual(["2"]);
  });
});
