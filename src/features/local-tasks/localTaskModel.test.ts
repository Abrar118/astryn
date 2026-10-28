import { describe, expect, it } from "vitest";
import type { LocalStatus, LocalTask, LocalTree } from "@/lib/commands";
import {
  barFor,
  groupByStatus,
  positionBefore,
  sortTasks,
  statusesForList,
  suggestKey,
  timelineRange,
  visibleTasks,
} from "./localTaskModel";

function status(id: string, category: LocalStatus["category"], position: number, scopeId = "sp"): LocalStatus {
  return { id, scopeId, name: id, category, color: "#999999", position };
}

function task(id: string, over: Partial<LocalTask> = {}): LocalTask {
  return {
    id, identifier: `T-${id}`, title: `Task ${id}`, description: null, dueDate: null, startedAt: null, priority: 0,
    url: "", stateId: "todo", stateName: "To do", stateType: "unstarted", stateColor: "#999", assigneeId: null,
    assigneeName: null, teamId: "list", teamKey: "T", projectId: "sp", projectName: "Space", parentId: null,
    estimate: null, cycleName: null, cycleNumber: null, milestoneName: null, linkCount: 0, prCount: 0,
    attachmentsTruncated: false, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", labels: [],
    startDate: null, spaceId: "sp", sprintId: null, position: 1, listName: "List", checklistDone: 0, checklistTotal: 0,
    ...over,
  };
}

const tree: LocalTree = {
  spaces: [{ id: "sp", name: "Space", position: 0 }],
  lists: [
    { id: "list", spaceId: "sp", name: "List", key: "T", position: 0 },
    { id: "own", spaceId: "sp", name: "Own", key: "OWN", position: 1 },
  ],
  statuses: [
    status("done", "completed", 1),
    status("todo", "unstarted", 0),
    status("o1", "started", 0, "own"),
  ],
  sprints: [],
  labels: [],
};

describe("statusesForList", () => {
  it("uses the list's override, else its space's workflow, in order", () => {
    expect(statusesForList(tree, "list").map((s) => s.id)).toEqual(["todo", "done"]);
    expect(statusesForList(tree, "own").map((s) => s.id)).toEqual(["o1"]);
    expect(statusesForList(tree, "missing")).toEqual([]);
  });
});

describe("groupByStatus", () => {
  it("groups top-level tasks by status in workflow order, sorted by position", () => {
    const groups = groupByStatus(
      [task("a", { position: 2 }), task("b", { position: 1 }), task("c", { stateId: "done" }), task("sub", { parentId: "a" })],
      statusesForList(tree, "list"),
    );
    expect(groups.map((g) => [g.status.id, g.tasks.map((t) => t.id)])).toEqual([
      ["todo", ["b", "a"]],
      ["done", ["c"]],
    ]);
  });

  it("keeps a subtask whose parent is not in the list as top-level", () => {
    const groups = groupByStatus([task("orphan", { parentId: "elsewhere" })], statusesForList(tree, "list"));
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["orphan"]);
  });
});

describe("visibleTasks", () => {
  const rows = [
    task("open", { assigneeId: "lt_me", sprintId: "s1" }),
    task("closed", { stateType: "completed" }),
    task("canceled", { stateType: "canceled", assigneeId: "lt_me" }),
  ];
  it("hides closed tasks unless asked", () => {
    expect(visibleTasks(rows, { showClosed: false }).map((t) => t.id)).toEqual(["open"]);
    expect(visibleTasks(rows, { showClosed: true })).toHaveLength(3);
  });
  it("filters to my tasks and a sprint", () => {
    expect(visibleTasks(rows, { showClosed: true, mineOnly: true }).map((t) => t.id)).toEqual(["open", "canceled"]);
    expect(visibleTasks(rows, { showClosed: true, sprintId: "s1" }).map((t) => t.id)).toEqual(["open"]);
  });
});

describe("sortTasks", () => {
  it("sorts by due date with empty dates last, both directions", () => {
    const rows = [task("x"), task("y", { dueDate: "2026-11-02" }), task("z", { dueDate: "2026-11-01" })];
    expect(sortTasks(rows, "due", "asc").map((t) => t.id)).toEqual(["z", "y", "x"]);
    expect(sortTasks(rows, "due", "desc").map((t) => t.id)).toEqual(["y", "z", "x"]);
  });
  it("ranks urgent first and no priority last", () => {
    const rows = [task("none"), task("low", { priority: 4 }), task("urgent", { priority: 1 })];
    expect(sortTasks(rows, "priority", "asc").map((t) => t.id)).toEqual(["urgent", "low", "none"]);
  });
});

describe("suggestKey", () => {
  it("abbreviates the name and avoids taken keys", () => {
    expect(suggestKey("Website redesign", [])).toBe("WR");
    expect(suggestKey("Operations", [])).toBe("OPER");
    expect(suggestKey("Operations", ["OPER"])).toBe("OPER2");
    expect(suggestKey("123", [])).toBe("L");
  });
});

describe("positionBefore", () => {
  it("places between neighbours, or before the first", () => {
    expect(positionBefore(undefined, 4)).toBe(3);
    expect(positionBefore(2, 4)).toBe(3);
    expect(positionBefore(5, undefined)).toBe(6);
  });
});

describe("timeline", () => {
  it("spans whole Sunday-started weeks around the dated tasks with room after", () => {
    const rows = [task("a", { startDate: "2026-10-28", dueDate: "2026-11-04" })];
    const range = timelineRange(rows, "2026-10-28");
    expect(range.start).toBe("2026-10-18");
    expect(range.days % 7).toBe(0);
    expect(range.days).toBeGreaterThanOrEqual(42);
  });

  it("draws start-to-due bars and one-day bars for a single date", () => {
    expect(barFor(task("a", { startDate: "2026-10-28", dueDate: "2026-10-30" }), "2026-10-25")).toEqual({ offset: 3, span: 3 });
    expect(barFor(task("b", { dueDate: "2026-10-26" }), "2026-10-25")).toEqual({ offset: 1, span: 1 });
    expect(barFor(task("c"), "2026-10-25")).toBeNull();
    // A start after the due date still draws a one-day bar at the due date.
    expect(barFor(task("d", { startDate: "2026-10-30", dueDate: "2026-10-27" }), "2026-10-25")).toEqual({ offset: 2, span: 1 });
  });
});
