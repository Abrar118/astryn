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

  // Relation edges, both endpoints visible.
  for (const r of index.relations) {
    if (visibleIds.has(r.issueId) && visibleIds.has(r.relatedId)) {
      const key = `rel|${r.issueId}|${r.relatedId}|${r.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ source: r.issueId, target: r.relatedId, kind: r.type });
      }
    }
  }

  return { nodes, edges };
}
