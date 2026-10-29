import { describe, expect, it } from "vitest";
import type { IssueListItem } from "@/lib/commands";
import { weekWindow } from "@/lib/dates";
import { ALL_DAYS } from "@/lib/workweek";
import { buildAgenda } from "./agenda";
import { OVERDUE, boardColumns, dayLabel, dropDueDate, stepDay, type BoardColumn } from "./weekColumns";

function iss(over: Partial<IssueListItem> & { id: string }): IssueListItem {
  return {
    identifier: `ENG-${over.id}`,
    title: "T",
    description: null,
    dueDate: null,
    startedAt: null,
    priority: 0,
    url: "u",
    stateId: null,
    stateName: "Todo",
    stateType: "unstarted",
    stateColor: "#fff",
    assigneeId: "me",
    assigneeName: "Me",
    teamId: null,
    teamKey: null,
    projectId: null,
    projectName: null,
    parentId: null,
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

// 18:30 UTC on Saturday Oct 24 is already 00:30 on Sunday Oct 25 in Dhaka (UTC+6),
// so the Dhaka week (Sunday first) is Oct 25–31, not the UTC week of Oct 18.
const NOW = new Date("2026-10-24T18:30:00Z");
const WIN = weekWindow(NOW);

const columnsFor = (issues: IssueListItem[], workdays: readonly number[] = ALL_DAYS, includeOverdue = true) =>
  boardColumns(buildAgenda({ issues, viewerIds: ["me"], window: WIN, includeOverdue }), WIN, workdays, includeOverdue);

const ids = (cols: BoardColumn[], key: string) => cols.find((c) => c.key === key)?.cards.map((t) => t.id);

describe("boardColumns", () => {
  it("lays out Overdue then the Asia/Dhaka week, Sunday first", () => {
    expect(WIN.weekStart).toBe("2026-10-25");
    const cols = columnsFor([]);
    expect(cols.map((c) => c.key)).toEqual([
      OVERDUE,
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
    ]);
    expect(cols.map((c) => c.label)).toEqual(["overdue", "sun 25", "mon 26", "tue 27", "wed 28", "thu 29", "fri 30", "sat 31"]);
  });

  it("buckets open past-due tasks into Overdue and the rest onto their own day", () => {
    const cols = columnsFor([
      iss({ id: "late", dueDate: "2026-10-24", stateType: "started" }),
      iss({ id: "done-late", dueDate: "2026-10-24", stateType: "completed" }),
      iss({ id: "sun", dueDate: "2026-10-25" }),
      iss({ id: "fri", dueDate: "2026-10-30" }),
      iss({ id: "sat", dueDate: "2026-10-31", stateType: "completed" }),
      iss({ id: "next-week", dueDate: "2026-11-01" }),
      iss({ id: "theirs", dueDate: "2026-10-26", assigneeId: "someone" }),
      iss({ id: "lt_local", dueDate: "2026-10-26", assigneeId: "local-me" }),
    ]);
    expect(ids(cols, OVERDUE)).toEqual(["late"]);
    expect(ids(cols, "2026-10-25")).toEqual(["sun"]);
    expect(ids(cols, "2026-10-26")).toEqual([]);
    expect(ids(cols, "2026-10-30")).toEqual(["fri"]);
    expect(ids(cols, "2026-10-31")).toEqual(["sat"]);
    expect(cols.flatMap((c) => c.cards).map((t) => t.id)).not.toContain("next-week");
  });

  it("merges every tracker's viewer and gives sub-issues their own card", () => {
    const issues = [
      iss({ id: "p", dueDate: "2026-10-27", priority: 2 }),
      iss({ id: "c", dueDate: "2026-10-27", parentId: "p", priority: 1 }),
      iss({ id: "lt_1", identifier: "LT-1", dueDate: "2026-10-27", assigneeId: "local-me", priority: 3 }),
    ];
    const cols = boardColumns(
      buildAgenda({ issues, viewerIds: ["me", "local-me"], window: WIN }),
      WIN,
      ALL_DAYS,
      true,
    );
    expect(ids(cols, "2026-10-27")).toEqual(["c", "p", "lt_1"]);
  });

  it("sorts days by priority then identifier, and Overdue oldest first", () => {
    const cols = columnsFor([
      iss({ id: "a", identifier: "ENG-3", dueDate: "2026-10-28", priority: 0 }),
      iss({ id: "b", identifier: "ENG-2", dueDate: "2026-10-28", priority: 1 }),
      iss({ id: "c", identifier: "ENG-1", dueDate: "2026-10-28", priority: 1 }),
      iss({ id: "old", dueDate: "2026-10-01", priority: 4 }),
      iss({ id: "new", dueDate: "2026-10-20", priority: 1 }),
    ]);
    expect(ids(cols, "2026-10-28")).toEqual(["c", "b", "a"]);
    expect(ids(cols, OVERDUE)).toEqual(["old", "new"]);
  });

  it("drops days the workweek hides unless something is due on them", () => {
    const sunToThu = [0, 1, 2, 3, 4];
    expect(columnsFor([], sunToThu).map((c) => c.label)).toEqual(["overdue", "sun 25", "mon 26", "tue 27", "wed 28", "thu 29"]);
    const withSat = columnsFor([iss({ id: "s", dueDate: "2026-10-31" })], sunToThu);
    expect(withSat.map((c) => c.label)).toEqual(["overdue", "sun 25", "mon 26", "tue 27", "wed 28", "thu 29", "sat 31"]);
  });

  it("leaves Overdue out for other weeks", () => {
    const cols = columnsFor([iss({ id: "late", dueDate: "2026-10-01", stateType: "started" })], ALL_DAYS, false);
    expect(cols[0].key).toBe("2026-10-25");
    expect(cols).toHaveLength(7);
  });
});

describe("dayLabel", () => {
  it("names the day in lowercase with its date", () => {
    expect(dayLabel("2026-11-01")).toBe("sun 1");
  });
});

describe("stepDay", () => {
  const cols = columnsFor([], [0, 1, 2, 3, 4]); // Sun–Thu shown, Fri/Sat hidden

  it("steps to the neighbouring day column", () => {
    expect(stepDay(cols, "2026-10-27", 1, "2026-10-29")).toBe("2026-10-28");
    expect(stepDay(cols, "2026-10-27", -1, "2026-10-29")).toBe("2026-10-26");
  });

  it("never lands on Overdue or past the last shown day", () => {
    expect(stepDay(cols, "2026-10-25", -1, "2026-10-29")).toBeNull();
    expect(stepDay(cols, "2026-10-29", 1, "2026-10-29")).toBeNull();
    expect(stepDay(cols, OVERDUE, -1, "2026-10-29")).toBeNull();
  });

  it("moves an overdue card onto today", () => {
    expect(stepDay(cols, OVERDUE, 1, "2026-10-29")).toBe("2026-10-29");
  });
});

describe("dropDueDate", () => {
  const task = iss({ id: "t", dueDate: "2026-10-26" });

  it("sets the due date to the day dropped on", () => {
    expect(dropDueDate(task, "day:2026-10-28")).toBe("2026-10-28");
  });

  it("ignores a drop on the same day, on Overdue, or outside the board", () => {
    expect(dropDueDate(task, "day:2026-10-26")).toBeNull();
    expect(dropDueDate(task, OVERDUE)).toBeNull();
    expect(dropDueDate(task, null)).toBeNull();
    expect(dropDueDate(undefined, "day:2026-10-28")).toBeNull();
  });
});
