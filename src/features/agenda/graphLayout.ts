import ELK from "elkjs/lib/elk.bundled.js";
import type { Node, Edge } from "@xyflow/react";
import type { GraphGroup } from "./graphModel";

const elk = new ELK();

const NODE_W = 200;
const NODE_H = 56;

const FLAT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "90",
  "elk.spacing.nodeNode": "40",
};

const ROOT_GROUPED_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.layered.spacing.nodeNodeBetweenLayers": "120",
  "elk.spacing.nodeNode": "70",
};

const GROUP_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.padding": "[top=30.0,left=14.0,bottom=14.0,right=14.0]",
  "elk.layered.spacing.nodeNodeBetweenLayers": "90",
  "elk.spacing.nodeNode": "40",
};

/** Position nodes with elk; nests them into group containers when `groups` is given. */
export async function layoutGraph(
  nodes: Node[],
  edges: Edge[],
  groups: GraphGroup[] = [],
): Promise<Node[]> {
  if (nodes.length === 0) return nodes;

  if (groups.length === 0) {
    const graph = {
      id: "root",
      layoutOptions: FLAT_OPTIONS,
      children: nodes.map((n) => ({ id: n.id, width: NODE_W, height: NODE_H })),
      edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    };
    const res = await elk.layout(graph);
    const pos = new Map((res.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
    return nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position }));
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const graph = {
    id: "root",
    layoutOptions: ROOT_GROUPED_OPTIONS,
    children: groups.map((g) => ({
      id: g.id,
      layoutOptions: GROUP_OPTIONS,
      children: g.memberIds
        .filter((id) => nodeById.has(id))
        .map((id) => ({ id, width: NODE_W, height: NODE_H })),
    })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  const res = await elk.layout(graph);
  const labelById = new Map(groups.map((g) => [g.id, g.label]));
  const out: Node[] = [];
  for (const gi of res.children ?? []) {
    const children = gi.children ?? [];
    out.push({
      id: gi.id,
      type: "group",
      position: { x: gi.x ?? 0, y: gi.y ?? 0 },
      data: { label: labelById.get(gi.id) ?? "", count: children.length },
      style: { width: gi.width ?? 0, height: gi.height ?? 0 },
      selectable: false,
      draggable: false,
    });
    for (const ci of children) {
      const orig = nodeById.get(ci.id);
      if (!orig) continue;
      out.push({
        ...orig,
        parentId: gi.id,
        extent: "parent",
        position: { x: ci.x ?? 0, y: ci.y ?? 0 },
      });
    }
  }
  return out;
}
