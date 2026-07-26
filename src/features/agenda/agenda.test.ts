import { describe, it, expect } from "vitest";
import { buildAgenda, dueIssues } from "./agenda";
import type { IssueListItem } from "../../lib/commands";
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
    startedAt: over.startedAt ?? null,
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

/** Compact structural view of a group: "id" | "id>[child ids]" | "(id)>[…]" for context parents. */
const shape = (gs: ReturnType<typeof buildAgenda>, key: string) =>
  find(gs, key)!.items.map((it) => {
    const head = it.contextOnly ? `(${it.issue.id})` : it.issue.id;
    return it.children.length ? `${head}>[${it.children.map((c) => c.id).join(",")}]` : head;
  });

describe("buildAgenda", () => {
  it("buckets the viewer's issues by weekday and always renders Sun-Thu", () => {
    const issues = [iss({ id: "1", dueDate: "2026-06-22" })];
    const gs = buildAgenda({ issues, viewerId: "me", window: WINDOW });
    expect(gs.filter((g) => g.date).map((g) => g.key)).toEqual(WINDOW.weekdays);
    expect(shape(gs, "2026-06-22")).toEqual(["1"]);
    expect(find(gs, "2026-06-21")!.items).toEqual([]); // empty weekday still present
  });

  it("excludes other people's issues and undated issues", () => {
    const issues = [
      iss({ id: "1", dueDate: "2026-06-22", assigneeId: "someone" }),
      iss({ id: "2", dueDate: null }),
    ];
    const gs = buildAgenda({ issues, viewerId: "me", window: WINDOW });
    expect(gs.flatMap((g) => g.items)).toEqual([]);
  });

  it("puts past-due open issues in Overdue but not completed/canceled ones", () => {
    const issues = [
      iss({ id: "1", dueDate: "2026-06-10", stateType: "started" }),
      iss({ id: "2", dueDate: "2026-06-10", stateType: "completed" }),
    ];
    const gs = buildAgenda({ issues, viewerId: "me", window: WINDOW });
    expect(shape(gs, "overdue")).toEqual(["1"]);
  });

  it("folds Friday/Saturday into a Weekend group only when non-empty", () => {
    const noWeekend = buildAgenda({
      issues: [iss({ id: "1", dueDate: "2026-06-22" })],
      viewerId: "me", window: WINDOW,
    });
    expect(find(noWeekend, "weekend")).toBeUndefined();
    const withWeekend = buildAgenda({
      issues: [iss({ id: "2", dueDate: "2026-06-26" })],
      viewerId: "me", window: WINDOW,
    });
    expect(shape(withWeekend, "weekend")).toEqual(["2"]);
  });

  it("nests a sub-issue under its parent when both are due in the same group", () => {
    const issues = [
      iss({ id: "p", dueDate: "2026-06-22" }),
      iss({ id: "c", dueDate: "2026-06-22", parentId: "p" }),
    ];
    const gs = buildAgenda({ issues, viewerId: "me", window: WINDOW });
    expect(shape(gs, "2026-06-22")).toEqual(["p>[c]"]);
  });

  it("keeps a sub-issue on its own due date, under a context-only parent heading", () => {
    const issues = [
      iss({ id: "p", dueDate: "2026-06-22" }),
      iss({ id: "c", dueDate: "2026-06-23", parentId: "p" }), // mine AND due this week
    ];
    const gs = buildAgenda({ issues, viewerId: "me", window: WINDOW });
    expect(shape(gs, "2026-06-22")).toEqual(["p"]);
    expect(shape(gs, "2026-06-23")).toEqual(["(p)>[c]"]);
  });

  it("shows a context heading for an undated/unassigned parent, and none when the parent is unknown", () => {
    const issues = [
      iss({ id: "p", identifier: "ENG-1", dueDate: null, assigneeId: "someone" }),
      iss({ id: "c1", dueDate: "2026-06-22", parentId: "p" }),
      iss({ id: "c2", dueDate: "2026-06-22", parentId: "p" }),
      iss({ id: "orphan", identifier: "ENG-9", dueDate: "2026-06-22", parentId: "missing" }),
    ];
    const gs = buildAgenda({ issues, viewerId: "me", window: WINDOW });
    expect(shape(gs, "2026-06-22")).toEqual(["(p)>[c1,c2]", "orphan"]);
  });

  it("places dated sub-issues on their own day even when the parent is overdue/out of week (regression)", () => {
    // Real chain: PSY-126 (06-11, overdue) -> PSY-355 (06-24) -> PSY-402/403 (06-23).
    // The old dedup hoisted 355 under 126 and dropped 402/403 entirely.
    const issues = [
      iss({ id: "126", dueDate: "2026-06-11", stateType: "started" }),
      iss({ id: "355", dueDate: "2026-06-24", parentId: "126" }),
      iss({ id: "402", dueDate: "2026-06-23", parentId: "355" }),
      iss({ id: "403", dueDate: "2026-06-23", parentId: "355" }),
    ];
    const gs = buildAgenda({ issues, viewerId: "me", window: WINDOW });
    expect(shape(gs, "overdue")).toEqual(["126"]);
    expect(shape(gs, "2026-06-24")).toEqual(["(126)>[355]"]);
    expect(shape(gs, "2026-06-23")).toEqual(["(355)>[402,403]"]);
  });

  it("dueIssues counts nested children but not context-only parents", () => {
    const issues = [
      iss({ id: "p", dueDate: "2026-06-22" }),
      iss({ id: "c", dueDate: "2026-06-23", parentId: "p" }),
      iss({ id: "d", dueDate: "2026-06-23" }),
    ];
    const gs = buildAgenda({ issues, viewerId: "me", window: WINDOW });
    expect(dueIssues(find(gs, "2026-06-22")!).map((i) => i.id)).toEqual(["p"]);
    expect(dueIssues(find(gs, "2026-06-23")!).map((i) => i.id).sort()).toEqual(["c", "d"]);
  });

  it("sorts within a day by priority then identifier, ranking a heading by its most urgent child", () => {
    const issues = [
      iss({ id: "a", identifier: "ENG-3", dueDate: "2026-06-22", priority: 0 }), // none -> last
      iss({ id: "b", identifier: "ENG-2", dueDate: "2026-06-22", priority: 1 }), // urgent -> first
      iss({ id: "c", identifier: "ENG-1", dueDate: "2026-06-22", priority: 1 }),
      iss({ id: "p", identifier: "ENG-9", dueDate: null }),
      iss({ id: "u", identifier: "ENG-4", dueDate: "2026-06-22", priority: 1, parentId: "p" }),
    ];
    const gs = buildAgenda({ issues, viewerId: "me", window: WINDOW });
    // Urgent child ranks its (priority-less) context heading among the urgent rows.
    expect(shape(gs, "2026-06-22")).toEqual(["c", "b", "(p)>[u]", "a"]);
  });

  it("omits Overdue group when includeOverdue is false, even with past-due open issues", () => {
    const issues = [
      iss({ id: "1", dueDate: "2026-06-10", stateType: "started" }), // past-due open issue
      iss({ id: "2", dueDate: "2026-06-22" }), // normal weekday issue
    ];
    const gs = buildAgenda({ issues, viewerId: "me", window: WINDOW, includeOverdue: false });
    expect(find(gs, "overdue")).toBeUndefined();
    // Weekday groups still present
    expect(gs.filter((g) => g.date).map((g) => g.key)).toEqual(WINDOW.weekdays);
    expect(shape(gs, "2026-06-22")).toEqual(["2"]);
  });
});
