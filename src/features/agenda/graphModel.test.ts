import { describe, it, expect } from "vitest";
import {
  buildIndex,
  neighbors,
  computeVisible,
  hiddenNeighborCount,
  buildGraphElements,
  groupKeyOf,
  buildGroups,
  bulkStatusTeamId,
} from "./graphModel";
import type { IssueListItem, Relation } from "../../lib/commands";

/** Minimal issue fixture — only fields the model reads. */
function iss(over: Partial<IssueListItem> & { id: string }): IssueListItem {
  const stateName = over.stateName ?? "Todo";
  return {
    identifier: over.identifier ?? `ENG-${over.id}`,
    title: over.title ?? "T",
    description: null,
    dueDate: over.dueDate ?? null,
    priority: over.priority ?? 0,
    url: "u",
    stateId: over.stateId ?? (stateName ? `s_${stateName.replace(/\s+/g, "_")}` : null),
    stateName,
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

function rel(issueId: string, type: string, relatedId: string): Relation {
  return {
    issueId,
    type,
    relatedId,
    relatedIdentifier: null,
    relatedTitle: null,
    relatedStateName: null,
    relatedStateType: null,
    relatedStateColor: null,
  };
}

// Graph: A(root) — B is child of A; C blocks A; D is related to B.
const issues = [
  iss({ id: "A" }),
  iss({ id: "B", parentId: "A" }),
  iss({ id: "C" }),
  iss({ id: "D" }),
];
const relations = [rel("C", "blocks", "A"), rel("B", "related", "D")];
const index = buildIndex(issues, relations);

describe("neighbors", () => {
  it("includes children, parent, and relations (both directions)", () => {
    expect(neighbors("A", index)).toEqual(new Set(["B", "C"]));
    expect(neighbors("B", index)).toEqual(new Set(["A", "D"]));
    expect(neighbors("C", index)).toEqual(new Set(["A"]));
  });
});

describe("computeVisible", () => {
  it("shows only roots when nothing is expanded", () => {
    expect(computeVisible(["A"], new Set(), index)).toEqual(new Set(["A"]));
  });

  it("reveals a node's direct neighbors when it is expanded", () => {
    expect(computeVisible(["A"], new Set(["A"]), index)).toEqual(new Set(["A", "B", "C"]));
  });

  it("reveals the next ring when a revealed node is also expanded", () => {
    expect(computeVisible(["A"], new Set(["A", "B"]), index)).toEqual(
      new Set(["A", "B", "C", "D"]),
    );
  });

  it("drops orphans when an intermediate node is no longer expanded", () => {
    // B expanded but A is not, so B never becomes visible — only the root shows.
    expect(computeVisible(["A"], new Set(["B"]), index)).toEqual(new Set(["A"]));
  });

  it("is cycle-safe", () => {
    const cyc = buildIndex(
      [iss({ id: "X" }), iss({ id: "Y" })],
      [rel("X", "related", "Y"), rel("Y", "related", "X")],
    );
    expect(computeVisible(["X"], new Set(["X", "Y"]), cyc)).toEqual(new Set(["X", "Y"]));
  });
});

describe("hiddenNeighborCount", () => {
  it("counts neighbors not in the visible set", () => {
    expect(hiddenNeighborCount("A", new Set(["A"]), index)).toBe(2);
    expect(hiddenNeighborCount("A", new Set(["A", "B", "C"]), index)).toBe(0);
  });
});

describe("buildGraphElements", () => {
  it("emits one node per visible id with isRoot and hiddenCount", () => {
    const visible = computeVisible(["A"], new Set(["A"]), index);
    const { nodes } = buildGraphElements(visible, new Set(["A"]), index);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get("A")).toEqual({ id: "A", isRoot: true, hiddenCount: 0 });
    expect(byId.get("B")).toEqual({ id: "B", isRoot: false, hiddenCount: 1 });
    expect(byId.get("C")).toEqual({ id: "C", isRoot: false, hiddenCount: 0 });
  });

  it("emits sub-issue and relation edges only between visible nodes", () => {
    const visible = computeVisible(["A"], new Set(["A"]), index);
    const { edges } = buildGraphElements(visible, new Set(["A"]), index);
    expect(edges).toContainEqual({ source: "A", target: "B", kind: "sub_issue" });
    expect(edges).toContainEqual({ source: "C", target: "A", kind: "blocks" });
    // B—D relation is excluded because D is not visible.
    expect(edges.some((e) => e.target === "D")).toBe(false);
  });

  it("collapses a bidirectional relationship into a single canonical edge", () => {
    const bi = buildIndex(
      [iss({ id: "C" }), iss({ id: "A" })],
      [rel("C", "blocks", "A"), rel("A", "blocked_by", "C")],
    );
    const visible = new Set(["C", "A"]);
    const { edges } = buildGraphElements(visible, new Set(["A"]), bi);
    const relEdges = edges.filter((e) => e.kind === "blocks" || e.kind === "blocked_by");
    expect(relEdges).toEqual([{ source: "C", target: "A", kind: "blocks" }]);
  });
});

describe("groupKeyOf", () => {
  it("returns null for none", () => {
    expect(groupKeyOf(iss({ id: "1" }), "none")).toBeNull();
  });
  it("groups by status name with fallback", () => {
    expect(groupKeyOf(iss({ id: "1", stateName: "In Progress" }), "status")?.label).toBe("In Progress");
    expect(groupKeyOf(iss({ id: "1", stateName: null }), "status")?.label).toBe("No status");
  });
  it("groups by project with fallback", () => {
    expect(groupKeyOf(iss({ id: "1", projectName: "Apollo" }), "project")?.label).toBe("Apollo");
    expect(groupKeyOf(iss({ id: "1", projectName: null }), "project")?.label).toBe("No project");
  });
  it("groups by cycle name, number, then fallback", () => {
    expect(groupKeyOf(iss({ id: "1", cycleName: "Sprint 4" }), "cycle")?.label).toBe("Sprint 4");
    expect(groupKeyOf(iss({ id: "1", cycleName: null, cycleNumber: 7 }), "cycle")?.label).toBe("Cycle 7");
    expect(groupKeyOf(iss({ id: "1", cycleName: null, cycleNumber: null }), "cycle")?.label).toBe("No cycle");
  });
});

describe("buildGroups", () => {
  const index = buildIndex(
    [
      iss({ id: "A", stateName: "Todo" }),
      iss({ id: "B", stateName: "Todo" }),
      iss({ id: "C", stateName: "Done" }),
    ],
    [],
  );
  it("returns [] when groupBy is none", () => {
    expect(buildGroups(new Set(["A", "B"]), "none", index)).toEqual([]);
  });
  it("buckets visible issues by the dimension", () => {
    const groups = buildGroups(new Set(["A", "B", "C"]), "status", index);
    const byLabel = new Map(groups.map((g) => [g.label, g.memberIds.sort()]));
    expect(byLabel.get("Todo")).toEqual(["A", "B"]);
    expect(byLabel.get("Done")).toEqual(["C"]);
  });
  it("puts ids missing from the cache in the catch-all bucket", () => {
    const groups = buildGroups(new Set(["A", "ghost"]), "status", index);
    const ghost = groups.find((g) => g.memberIds.includes("ghost"));
    expect(ghost?.label).toBe("No status");
  });
  it("keeps same-numbered cycles from different teams in separate groups", () => {
    const idx = buildIndex(
      [
        iss({ id: "A", teamId: "t1", cycleNumber: 3, cycleName: "Cycle 3" }),
        iss({ id: "B", teamId: "t2", cycleNumber: 3, cycleName: "Cycle 3" }),
      ],
      [],
    );
    const groups = buildGroups(new Set(["A", "B"]), "cycle", idx);
    expect(groups).toHaveLength(2);
  });
});

describe("bulkStatusTeamId", () => {
  const index = buildIndex(
    [
      iss({ id: "A", teamId: "t1" }),
      iss({ id: "B", teamId: "t1" }),
      iss({ id: "C", teamId: "t2" }),
      iss({ id: "D", teamId: null }),
    ],
    [],
  );
  it("returns the shared team when all selected agree", () => {
    expect(bulkStatusTeamId(["A", "B"], index)).toBe("t1");
  });
  it("returns null when teams differ", () => {
    expect(bulkStatusTeamId(["A", "C"], index)).toBeNull();
  });
  it("returns null when any selected has no team", () => {
    expect(bulkStatusTeamId(["A", "D"], index)).toBeNull();
  });
});
