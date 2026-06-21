import type { IssueListItem, Relation } from "../../lib/commands";

export type GraphIndex = {
  byId: Map<string, IssueListItem>;
  childrenByParent: Map<string, string[]>;
  /** Undirected relation adjacency: id → connected ids. */
  relAdj: Map<string, Set<string>>;
  relations: Relation[];
};

export function buildIndex(issues: IssueListItem[], relations: Relation[]): GraphIndex {
  const byId = new Map(issues.map((i) => [i.id, i]));

  const childrenByParent = new Map<string, string[]>();
  for (const i of issues) {
    if (!i.parentId) continue;
    const list = childrenByParent.get(i.parentId) ?? [];
    list.push(i.id);
    childrenByParent.set(i.parentId, list);
  }

  const relAdj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    const s = relAdj.get(a) ?? new Set<string>();
    s.add(b);
    relAdj.set(a, s);
  };
  for (const r of relations) {
    link(r.issueId, r.relatedId);
    link(r.relatedId, r.issueId);
  }

  return { byId, childrenByParent, relAdj, relations };
}

export function neighbors(id: string, index: GraphIndex): Set<string> {
  const out = new Set<string>();
  const issue = index.byId.get(id);
  if (issue?.parentId) out.add(issue.parentId);
  for (const c of index.childrenByParent.get(id) ?? []) out.add(c);
  for (const n of index.relAdj.get(id) ?? []) out.add(n);
  out.delete(id);
  return out;
}

export function computeVisible(
  rootIds: string[],
  expandedIds: Set<string>,
  index: GraphIndex,
): Set<string> {
  const visible = new Set<string>(rootIds);
  const queue = [...rootIds];
  while (queue.length) {
    const id = queue.shift()!;
    if (!expandedIds.has(id)) continue;
    for (const nb of neighbors(id, index)) {
      if (!visible.has(nb)) {
        visible.add(nb);
        queue.push(nb);
      }
    }
  }
  return visible;
}

export function hiddenNeighborCount(
  id: string,
  visibleIds: Set<string>,
  index: GraphIndex,
): number {
  let n = 0;
  for (const nb of neighbors(id, index)) if (!visibleIds.has(nb)) n++;
  return n;
}

export type GraphNode = { id: string; isRoot: boolean; hiddenCount: number };
export type GraphEdge = { source: string; target: string; kind: string };

export function buildGraphElements(
  visibleIds: Set<string>,
  rootIds: Set<string>,
  index: GraphIndex,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  for (const id of visibleIds) {
    nodes.push({
      id,
      isRoot: rootIds.has(id),
      hiddenCount: hiddenNeighborCount(id, visibleIds, index),
    });
  }

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  // Parent → child (sub-issue) edges, both endpoints visible.
  for (const id of visibleIds) {
    const issue = index.byId.get(id);
    if (issue?.parentId && visibleIds.has(issue.parentId)) {
      const key = `si|${issue.parentId}|${id}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ source: issue.parentId, target: id, kind: "sub_issue" });
      }
    }
  }

  // Relation edges (both endpoints visible), canonicalized so a relationship
  // stored from both sides (e.g. "C blocks A" + "A blocked_by C") yields one edge.
  const INVERSE: Record<string, string> = { blocked_by: "blocks", duplicate_of: "duplicate" };
  const SYMMETRIC = new Set(["related", "duplicate"]);
  for (const r of index.relations) {
    if (!visibleIds.has(r.issueId) || !visibleIds.has(r.relatedId)) continue;
    const inverse = INVERSE[r.type];
    const kind = inverse ?? r.type;
    const source = inverse ? r.relatedId : r.issueId;
    const target = inverse ? r.issueId : r.relatedId;
    const key = SYMMETRIC.has(kind)
      ? `rel|${kind}|${[source, target].sort().join("|")}`
      : `rel|${kind}|${source}|${target}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push({ source, target, kind });
    }
  }

  return { nodes, edges };
}

export type GroupBy = "none" | "status" | "project" | "cycle";
export type GraphGroup = { id: string; label: string; memberIds: string[] };

/** The group key + display label for an issue under a grouping dimension. */
export function groupKeyOf(
  issue: IssueListItem,
  groupBy: GroupBy,
): { key: string; label: string } | null {
  switch (groupBy) {
    case "none":
      return null;
    case "status":
      return issue.stateName
        ? { key: issue.stateId ?? "_none", label: issue.stateName }
        : { key: "_none", label: "No status" };
    case "project":
      return issue.projectName
        ? { key: issue.projectId ?? "_none", label: issue.projectName }
        : { key: "_none", label: "No project" };
    case "cycle":
      if (issue.cycleName) return { key: `c${issue.cycleNumber ?? issue.cycleName}`, label: issue.cycleName };
      if (issue.cycleNumber != null) return { key: `c${issue.cycleNumber}`, label: `Cycle ${issue.cycleNumber}` };
      return { key: "_none", label: "No cycle" };
  }
}

const NO_GROUP_LABEL: Record<Exclude<GroupBy, "none">, string> = {
  status: "No status",
  project: "No project",
  cycle: "No cycle",
};

/** Bucket the currently-visible issues into groups for the given dimension. */
export function buildGroups(
  visibleIds: Set<string>,
  groupBy: GroupBy,
  index: GraphIndex,
): GraphGroup[] {
  if (groupBy === "none") return [];
  const groups = new Map<string, GraphGroup>();
  for (const id of visibleIds) {
    const issue = index.byId.get(id);
    const g = issue ? groupKeyOf(issue, groupBy) : { key: "_none", label: NO_GROUP_LABEL[groupBy] };
    const key = g?.key ?? "_none";
    const label = g?.label ?? NO_GROUP_LABEL[groupBy];
    const gid = `grp|${groupBy}|${key}`;
    const grp = groups.get(gid) ?? { id: gid, label, memberIds: [] };
    grp.memberIds.push(id);
    groups.set(gid, grp);
  }
  return [...groups.values()];
}

/** The single teamId shared by all selected issues, or null if they differ / any lacks one. */
export function bulkStatusTeamId(selectedIds: string[], index: GraphIndex): string | null {
  let teamId: string | null | undefined;
  for (const id of selectedIds) {
    const t = index.byId.get(id)?.teamId ?? null;
    if (teamId === undefined) teamId = t;
    else if (teamId !== t) return null;
  }
  return teamId ?? null;
}
