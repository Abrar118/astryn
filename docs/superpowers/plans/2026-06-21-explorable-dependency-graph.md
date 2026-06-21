# Explorable Dependency Graph — Core (Spec 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the agenda dependency graph into an explorable graph that starts minimal (this-week roots), reveals neighbors on demand, and auto-lays-out with elkjs — plus a MiniMap and neighborhood focus-highlight.

**Architecture:** Pure graph logic (visible-set computation, neighbor counting, element building) lives in a framework-free `graphModel.ts` that is unit-tested. A thin `graphLayout.ts` wraps elkjs. `DependencyGraph.tsx` is the React Flow shell that wires exploration state, runs layout, and renders. No backend changes — all exploration is client-side over already-cached `useIssues`/`useRelations` data.

**Tech Stack:** React 19 + TypeScript (strict) + `@xyflow/react` (React Flow v12) + `elkjs` + Vitest.

## Global Constraints

- TypeScript is **strict** with `noUnusedLocals`/`noUnusedParameters` — no unused symbols.
- All external API calls stay in Rust; the webview is a pure consumer. (No API work here.)
- Dark-first Linear aesthetic; hairline borders; use theme CSS variables (`var(--color-card)`, etc.).
- Use **ripgrep (`rg`)** for searches.
- Rust manifest commands use `--manifest-path src-tauri/Cargo.toml` (no Rust changes in this plan).
- Gate commands: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.
- Branch: work on `m5-dependency-graph`.

---

## File Structure

- **Create** `src/features/agenda/graphModel.ts` — pure graph logic (index, neighbors, visible-set, counts, element descriptors).
- **Create** `src/features/agenda/graphModel.test.ts` — Vitest unit tests for the above.
- **Create** `src/features/agenda/graphLayout.ts` — elkjs layout wrapper.
- **Create** `src/elkjs.d.ts` — ambient module decl for the bundled elkjs entry.
- **Modify** `src/features/agenda/DependencyGraph.tsx` — full rework to explore model + elk + MiniMap; removes connector node, position persistence.
- **Modify** `src/features/agenda/DependencyGraphPage.tsx` — pass `rootIds` + `issues` + `relations`.
- **Modify** `package.json` — add `elkjs` dependency.

---

## Task 1: Graph model (pure logic + tests)

**Files:**
- Create: `src/features/agenda/graphModel.ts`
- Test: `src/features/agenda/graphModel.test.ts`

**Interfaces:**
- Produces:
  - `type GraphIndex = { byId: Map<string, IssueListItem>; childrenByParent: Map<string, string[]>; relAdj: Map<string, Set<string>>; relations: Relation[] }`
  - `buildIndex(issues: IssueListItem[], relations: Relation[]): GraphIndex`
  - `neighbors(id: string, index: GraphIndex): Set<string>`
  - `computeVisible(rootIds: string[], expandedIds: Set<string>, index: GraphIndex): Set<string>`
  - `hiddenNeighborCount(id: string, visibleIds: Set<string>, index: GraphIndex): number`
  - `type GraphNode = { id: string; isRoot: boolean; hiddenCount: number }`
  - `type GraphEdge = { source: string; target: string; kind: string }` (`kind` is `"sub_issue"` or a relation `type`)
  - `buildGraphElements(visibleIds: Set<string>, rootIds: Set<string>, index: GraphIndex): { nodes: GraphNode[]; edges: GraphEdge[] }`

- [ ] **Step 1: Write the failing test**

Create `src/features/agenda/graphModel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildIndex,
  neighbors,
  computeVisible,
  hiddenNeighborCount,
  buildGraphElements,
} from "./graphModel";
import type { IssueListItem, Relation } from "../../lib/commands";

/** Minimal issue fixture — only fields the model reads. */
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/agenda/graphModel.test.ts`
Expected: FAIL — cannot find module `./graphModel`.

- [ ] **Step 3: Write minimal implementation**

Create `src/features/agenda/graphModel.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/agenda/graphModel.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/features/agenda/graphModel.ts src/features/agenda/graphModel.test.ts
git commit -m "feat(graph): pure graph model for explorable dependency graph

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: elkjs layout wrapper

**Files:**
- Modify: `package.json`
- Create: `src/elkjs.d.ts`
- Create: `src/features/agenda/graphLayout.ts`

**Interfaces:**
- Consumes: `Node`, `Edge` from `@xyflow/react`.
- Produces: `layoutGraph(nodes: Node[], edges: Edge[]): Promise<Node[]>` — returns the same nodes with computed `position`.

- [ ] **Step 1: Install elkjs**

Run: `npm install elkjs`
Expected: `package.json` dependencies now include `elkjs`; `npm install` completes without error.

- [ ] **Step 2: Add the ambient module declaration**

Create `src/elkjs.d.ts`:

```ts
declare module "elkjs/lib/elk.bundled.js" {
  import ELK from "elkjs";
  export default ELK;
}
```

- [ ] **Step 3: Write the layout wrapper**

Create `src/features/agenda/graphLayout.ts`:

```ts
import ELK from "elkjs/lib/elk.bundled.js";
import type { Node, Edge } from "@xyflow/react";

const elk = new ELK();

const NODE_W = 200;
const NODE_H = 56;

const LAYOUT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "90",
  "elk.spacing.nodeNode": "40",
};

/** Position nodes with elk's layered algorithm (left → right). */
export async function layoutGraph(nodes: Node[], edges: Edge[]): Promise<Node[]> {
  if (nodes.length === 0) return nodes;

  const graph = {
    id: "root",
    layoutOptions: LAYOUT_OPTIONS,
    children: nodes.map((n) => ({ id: n.id, width: NODE_W, height: NODE_H })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  const res = await elk.layout(graph);
  const pos = new Map((res.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
  return nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position }));
}
```

- [ ] **Step 4: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). If elkjs types complain about the bundled import, confirm `src/elkjs.d.ts` exists and is included by `tsconfig`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/elkjs.d.ts src/features/agenda/graphLayout.ts
git commit -m "feat(graph): add elkjs auto-layout wrapper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Rework DependencyGraph.tsx (explore model + elk + MiniMap)

This task replaces the file wholesale. There is no unit test (React Flow shell is visual/async); it is verified by typecheck + build + the manual checklist in Step 4.

**Files:**
- Modify (replace contents): `src/features/agenda/DependencyGraph.tsx`

**Interfaces:**
- Consumes: `buildIndex`, `computeVisible`, `buildGraphElements`, `neighbors` from `./graphModel`; `layoutGraph` from `./graphLayout`; `useIssueMenu` (with `MenuExtraAction`) from `@/features/issues/IssueContextMenu`.
- Produces: `DependencyGraph(props: { rootIds: string[]; issues: IssueListItem[]; relations: Relation[]; onOpen: (id: string) => void })` — the only export consumed by `DependencyGraphPage`.

- [ ] **Step 1: Replace the file with the new implementation**

Replace the entire contents of `src/features/agenda/DependencyGraph.tsx` with:

```tsx
import "@xyflow/react/dist/style.css";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Panel,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type NodeTypes,
  type Node,
  type Edge,
} from "@xyflow/react";
import { ChevronDown, ChevronRight, Network, RotateCcw, Search, X } from "lucide-react";
import { mountIssueMentionHoverCard } from "@/features/drawer/comments/IssueMentionPill";
import { useIssueMenu } from "@/features/issues/IssueContextMenu";
import type { MentionTarget } from "@/features/drawer/markdownComponents";
import type { IssueListItem, Relation } from "@/lib/commands";
import { cn } from "@/lib/utils";
import { buildIndex, computeVisible, buildGraphElements, neighbors } from "./graphModel";
import { layoutGraph } from "./graphLayout";

// ── Mention-target helpers ───────────────────────────────────────────────────

function toMentionTarget(i: IssueListItem): MentionTarget {
  return {
    identifier: i.identifier,
    title: i.title,
    stateType: i.stateType,
    stateColor: i.stateColor,
    stateName: i.stateName,
    projectName: i.projectName,
    priority: i.priority,
    assigneeName: i.assigneeName,
  };
}

function mentionTargetFromRelation(rel: Relation): MentionTarget {
  return {
    identifier: rel.relatedIdentifier ?? rel.relatedId,
    title: rel.relatedTitle ?? rel.relatedIdentifier ?? rel.relatedId,
    stateType: rel.relatedStateType ?? "unstarted",
    stateColor: rel.relatedStateColor ?? "#6B7280",
    stateName: rel.relatedStateName,
    projectName: null,
    priority: 0,
    assigneeName: null,
  };
}

// ── Edge styling per relation kind ───────────────────────────────────────────

type EdgeKind = { label: string; color: string; dashed?: boolean; animated?: boolean };

const SUB_ISSUE: EdgeKind = { label: "Sub-issue", color: "#6366f1", dashed: true };

const EDGE_KINDS: Record<string, EdgeKind> = {
  blocks: { label: "Blocks", color: "#ef4444", animated: true },
  blocked_by: { label: "Blocked by", color: "#f59e0b", animated: true },
  related: { label: "Related to", color: "#64748b", dashed: true },
  duplicate: { label: "Duplicate", color: "#a855f7", dashed: true },
  duplicate_of: { label: "Duplicate of", color: "#a855f7", dashed: true },
};

function edgeKindFor(kind: string): EdgeKind {
  if (kind === "sub_issue") return SUB_ISSUE;
  return EDGE_KINDS[kind] ?? { label: kind.replace(/_/g, " "), color: "#64748b", dashed: true };
}

const LEGEND: EdgeKind[] = [SUB_ISSUE, EDGE_KINDS.blocks, EDGE_KINDS.blocked_by, EDGE_KINDS.related];

// ── Node component ────────────────────────────────────────────────────────────

type IssueNodeData = {
  identifier: string;
  title: string;
  stateColor: string;
  issueId: string;
  isRoot: boolean;
  expanded: boolean;
  hiddenCount: number;
  highlight?: boolean;
  dimmed?: boolean;
  mentionTarget: MentionTarget;
  onOpen: (id: string) => void;
  onSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onContextMenu: (e: ReactMouseEvent, id: string) => void;
};

const HANDLE_CLASS = "!size-1.5 !border !border-border !bg-muted-foreground/70";

function nodeMatches(data: IssueNodeData, term: string): boolean {
  return data.identifier.toLowerCase().includes(term) || data.title.toLowerCase().includes(term);
}

function IssueNode({ data }: { data: IssueNodeData }) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const close = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  const scheduleOpen = useCallback(() => {
    if (timerRef.current !== null || cleanupRef.current !== null) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (nodeRef.current) {
        cleanupRef.current = mountIssueMentionHoverCard(
          data.mentionTarget,
          nodeRef.current.getBoundingClientRect(),
        );
      }
    }, 150);
  }, [data.mentionTarget]);

  useEffect(() => () => close(), [close]);

  const showToggle = data.expanded || data.hiddenCount > 0;

  return (
    <div
      ref={nodeRef}
      role="button"
      tabIndex={0}
      onMouseEnter={scheduleOpen}
      onMouseLeave={close}
      onClick={() => data.onSelect(data.issueId)}
      onDoubleClick={() => data.onOpen(data.issueId)}
      onContextMenu={(e) => {
        close();
        data.onContextMenu(e, data.issueId);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          data.onOpen(data.issueId);
        }
      }}
      className={cn(
        "relative flex w-[200px] cursor-pointer items-center gap-1.5 overflow-hidden rounded-lg border bg-card py-1.5 pl-3 pr-1.5 text-foreground shadow-sm transition-all hover:bg-accent focus-visible:outline-none",
        data.highlight
          ? "border-amber-400 ring-2 ring-amber-400"
          : data.isRoot
            ? "border-primary/40 ring-1 ring-primary/15"
            : "border-border",
        data.dimmed && "opacity-30",
      )}
    >
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: data.stateColor }}
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{ backgroundColor: data.stateColor }}
        aria-hidden
      />
      <Handle type="target" position={Position.Left} className={HANDLE_CLASS} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono text-[11px] font-semibold">{data.identifier}</span>
        <span className="truncate text-[11px] leading-snug text-muted-foreground">{data.title}</span>
      </div>
      {showToggle && (
        <button
          type="button"
          aria-label={data.expanded ? "Collapse neighbors" : `Expand ${data.hiddenCount} neighbors`}
          title={data.expanded ? "Collapse neighbors" : `Expand ${data.hiddenCount} neighbor${data.hiddenCount !== 1 ? "s" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            data.onToggleExpand(data.issueId);
          }}
          className="relative z-10 flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-background/80 px-1 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {data.expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <>
              {data.hiddenCount}
              <ChevronRight className="size-3" />
            </>
          )}
        </button>
      )}
      <Handle type="source" position={Position.Right} className={HANDLE_CLASS} />
    </div>
  );
}

const NODE_TYPES: NodeTypes = {
  issueNode: IssueNode as unknown as NodeTypes["issueNode"],
};

// ── Display resolution ────────────────────────────────────────────────────────

type Display = { identifier: string; title: string; stateColor: string; mentionTarget: MentionTarget };

function fallbackDisplay(id: string): Display {
  return {
    identifier: id,
    title: id,
    stateColor: "#6B7280",
    mentionTarget: {
      identifier: id,
      title: id,
      stateType: "unstarted",
      stateColor: "#6B7280",
      stateName: null,
      projectName: null,
      priority: 0,
      assigneeName: null,
    },
  };
}

// ── Main component ─────────────────────────────────────────────────────────────

type Props = {
  rootIds: string[];
  issues: IssueListItem[];
  relations: Relation[];
  onOpen: (id: string) => void;
};

export function DependencyGraph(props: Props) {
  if (props.rootIds.length === 0) {
    return (
      <div className="flex h-full min-h-72 w-full items-center justify-center rounded-lg border border-border bg-card text-sm text-muted-foreground">
        Nothing to graph this week
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <DependencyGraphInner {...props} />
    </ReactFlowProvider>
  );
}

function DependencyGraphInner({ rootIds, issues, relations, onOpen }: Props) {
  const index = useMemo(() => buildIndex(issues, relations), [issues, relations]);
  const indexRef = useRef(index);
  indexRef.current = index;
  const rootSet = useMemo(() => new Set(rootIds), [rootIds]);

  // Relation-ref fallback for related issues not in the issues cache.
  const relRefById = useMemo(() => {
    const m = new Map<string, Relation>();
    for (const r of relations) if (!m.has(r.relatedId)) m.set(r.relatedId, r);
    return m;
  }, [relations]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const expandedRef = useRef(expandedIds);
  expandedRef.current = expandedIds;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Stable handlers so node-data identity stays steady across re-renders.
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const handleOpen = useCallback((id: string) => openRef.current(id), []);
  const handleSelect = useCallback((id: string) => setSelectedId(id), []);
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const { openMenu } = useIssueMenu();
  const menuRef = useRef(openMenu);
  menuRef.current = openMenu;
  const handleContextMenu = useCallback(
    (e: ReactMouseEvent, id: string) => {
      const hasNeighbors = neighbors(id, indexRef.current).size > 0;
      const extra = hasNeighbors
        ? {
            label: expandedRef.current.has(id) ? "Collapse neighbors" : "Expand neighbors",
            icon: <Network className="size-4" />,
            onSelect: () => toggleExpand(id),
          }
        : null;
      menuRef.current(e, id, extra);
    },
    [toggleExpand],
  );

  const resolveDisplay = useCallback(
    (id: string): Display => {
      const iss = index.byId.get(id);
      if (iss) {
        return {
          identifier: iss.identifier,
          title: iss.title,
          stateColor: iss.stateColor,
          mentionTarget: toMentionTarget(iss),
        };
      }
      const ref = relRefById.get(id);
      if (ref) {
        return {
          identifier: ref.relatedIdentifier ?? id,
          title: ref.relatedTitle ?? id,
          stateColor: ref.relatedStateColor ?? "#6B7280",
          mentionTarget: mentionTargetFromRelation(ref),
        };
      }
      return fallbackDisplay(id);
    },
    [index, relRefById],
  );

  const elements = useMemo(() => {
    const visible = computeVisible(rootIds, expandedIds, index);
    return buildGraphElements(visible, rootSet, index);
  }, [rootIds, expandedIds, index, rootSet]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();
  const layoutToken = useRef(0);

  // Build React Flow elements + run elk layout whenever the visible set changes.
  useEffect(() => {
    const rfNodes: Node[] = elements.nodes.map((n) => {
      const d = resolveDisplay(n.id);
      return {
        id: n.id,
        type: "issueNode",
        position: { x: 0, y: 0 },
        data: {
          identifier: d.identifier,
          title: d.title,
          stateColor: d.stateColor,
          issueId: n.id,
          isRoot: n.isRoot,
          expanded: expandedIds.has(n.id),
          hiddenCount: n.hiddenCount,
          mentionTarget: d.mentionTarget,
          onOpen: handleOpen,
          onSelect: handleSelect,
          onToggleExpand: toggleExpand,
          onContextMenu: handleContextMenu,
        } satisfies IssueNodeData,
        width: 200,
      };
    });

    const rfEdges: Edge[] = elements.edges.map((e, i) => {
      const kind = edgeKindFor(e.kind);
      return {
        id: `e-${i}-${e.source}-${e.target}-${e.kind}`,
        source: e.source,
        target: e.target,
        type: "smoothstep",
        label: kind.label || undefined,
        animated: kind.animated ?? false,
        markerEnd: { type: MarkerType.ArrowClosed, color: kind.color, width: 16, height: 16 },
        style: {
          stroke: kind.color,
          strokeWidth: 1.5,
          strokeOpacity: 0.8,
          ...(kind.dashed ? { strokeDasharray: "5 4" } : {}),
        },
        labelStyle: { fontSize: 10, fontWeight: 500, fill: kind.color },
        labelShowBg: Boolean(kind.label),
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
        labelBgStyle: { fill: "var(--color-card)", fillOpacity: 0.95, stroke: kind.color, strokeOpacity: 0.35 },
      };
    });

    setEdges(rfEdges);
    const token = ++layoutToken.current;
    void layoutGraph(rfNodes, rfEdges).then((positioned) => {
      if (token !== layoutToken.current) return;
      setNodes(positioned);
      requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
    });
  }, [
    elements,
    resolveDisplay,
    expandedIds,
    handleOpen,
    handleSelect,
    toggleExpand,
    handleContextMenu,
    setNodes,
    setEdges,
    fitView,
  ]);

  const relayout = useCallback(() => {
    const token = ++layoutToken.current;
    void layoutGraph(nodes, edges).then((positioned) => {
      if (token !== layoutToken.current) return;
      setNodes(positioned);
      requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
    });
  }, [nodes, edges, setNodes, fitView]);

  // Search recenter on matches as the term changes.
  const term = query.trim().toLowerCase();
  useEffect(() => {
    if (!term) return;
    const matched = nodes
      .filter((n) => nodeMatches(n.data as IssueNodeData, term))
      .map((n) => ({ id: n.id }));
    if (matched.length) fitView({ nodes: matched, duration: 400, padding: 0.4, maxZoom: 1.5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  // Search highlight wins; otherwise selection drives the neighborhood focus.
  const displayNodes = useMemo(() => {
    if (term) {
      return nodes.map((n) => {
        const match = nodeMatches(n.data as IssueNodeData, term);
        return { ...n, data: { ...n.data, highlight: match, dimmed: !match } };
      });
    }
    if (selectedId) {
      const nbrs = neighbors(selectedId, index);
      return nodes.map((n) => {
        const inFocus = n.id === selectedId || nbrs.has(n.id);
        return { ...n, data: { ...n.data, highlight: n.id === selectedId, dimmed: !inFocus } };
      });
    }
    return nodes;
  }, [nodes, term, selectedId, index]);

  return (
    <div className="h-full min-h-72 w-full overflow-hidden rounded-lg border border-border bg-card">
      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onPaneClick={() => setSelectedId(null)}
        nodeTypes={NODE_TYPES}
        nodesDraggable
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: false }}
      >
        <Panel position="top-left">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search issues…"
                className="h-7 w-48 rounded-md border border-border bg-card/90 pl-7 pr-6 text-xs text-foreground shadow-sm backdrop-blur placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={relayout}
              title="Re-layout"
              className="flex items-center gap-1.5 rounded-md border border-border bg-card/90 px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
            >
              <RotateCcw className="size-3.5" />
              Re-layout
            </button>
          </div>
        </Panel>
        <Background gap={16} size={1} color="rgba(255,255,255,0.04)" />
        <Controls showInteractive={false} className="[&>button]:border-border [&>button]:bg-card [&>button]:text-foreground" />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => (n.data as IssueNodeData).stateColor}
          nodeStrokeWidth={2}
          className="!border !border-border !bg-card"
          maskColor="rgba(0,0,0,0.5)"
        />
        <Panel position="top-right">
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card/90 px-3 py-2 backdrop-blur">
            {LEGEND.map((k) => (
              <div key={k.label} className="flex items-center gap-2">
                <svg width="22" height="6" className="shrink-0" aria-hidden>
                  <line
                    x1="0"
                    y1="3"
                    x2="22"
                    y2="3"
                    stroke={k.color}
                    strokeWidth="1.5"
                    strokeDasharray={k.dashed ? "5 4" : undefined}
                  />
                </svg>
                <span className="text-[10px] text-muted-foreground">{k.label}</span>
              </div>
            ))}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (If errors mention `DependencyGraphPage` passing the old `items`/`allIssues` props, that's fixed in Task 4 — but `tsc` runs over the whole project, so expect those two errors here and resolve them in Task 4 before the final gate. To keep this task self-contained, proceed to Task 4 and run the gate there.)

- [ ] **Step 3: Verify the full suite still passes**

Run: `npx vitest run`
Expected: PASS — 223 prior tests + the new `graphModel` tests; no test imports the removed `ConnectorNode`.

- [ ] **Step 4: Commit**

```bash
git add src/features/agenda/DependencyGraph.tsx
git commit -m "feat(graph): explorable graph — start minimal, lazy expand, elk layout, minimap

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wire DependencyGraphPage to the new props + final gate

**Files:**
- Modify: `src/features/agenda/DependencyGraphPage.tsx`

**Interfaces:**
- Consumes: `DependencyGraph({ rootIds, issues, relations, onOpen })` from Task 3.

- [ ] **Step 1: Update the page to compute rootIds and pass new props**

Replace the body of `DependencyGraphPage` so the render branch reads:

```tsx
  const viewerId = me.data?.viewerId;
  const win = weekWindow(new Date(), 0);
  const groups = viewerId
    ? buildAgenda({ issues: issues ?? [], relations: relations ?? [], viewerId, window: win })
    : [];
  const rootIds = groups.flatMap((g) => g.items.map((it) => it.issue.id));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <Network className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold leading-tight">Dependencies</span>
          <span className="text-[11px] text-muted-foreground leading-tight">
            This week's issues — expand a node to explore its neighbors
          </span>
        </div>
      </header>
      <div className="min-h-0 flex-1 p-4">
        <DependencyGraph
          rootIds={rootIds}
          issues={issues ?? []}
          relations={relations ?? []}
          onOpen={open}
        />
      </div>
    </div>
  );
```

(The imports — `useSearchParams`, `Network`, `useIssues`, `useRelations`, `useMe`, `weekWindow`, `buildAgenda`, `DependencyGraph` — are already present; `AgendaItem`/`allIssues` are no longer referenced, so remove any now-unused import. The loading branch is unchanged.)

- [ ] **Step 2: Typecheck (now clean project-wide)**

Run: `npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all files green.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: built OK (the pre-existing chunk-size warning is fine).

- [ ] **Step 5: Manual verification checklist** (run `npm run tauri dev`, open the Dependencies view)

Confirm:
- Opens showing only this-week root issues; no neighbors until expanded.
- A node with hidden neighbors shows a `N ›` badge; clicking it reveals exactly its direct neighbors and the badge flips to a collapse chevron.
- Collapsing removes those neighbors (and any now-orphaned), recomputed correctly.
- Single-click highlights the node's neighborhood (others dim); clicking empty canvas clears it.
- Double-click opens the issue drawer; right-click shows the context menu with "Expand/Collapse neighbors".
- "Re-layout" reflows; MiniMap shows state-colored dots; controls + attribution are themed (dark).
- Search highlights/dims and recenters; legend renders.

- [ ] **Step 6: Commit**

```bash
git add src/features/agenda/DependencyGraphPage.tsx
git commit -m "feat(graph): wire Dependencies page to the explorable graph props

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** start-minimal (Task 1 `computeVisible` + Task 3 initial empty `expandedIds`), lazy expand/collapse (Task 1 + node badge + context-menu action), elk auto-layout (Task 2 + Task 3 effect), Re-layout button (Task 3), interaction model (Task 3 node handlers), MiniMap + focus-highlight (Task 3), removal of connector + persistence (Task 3 rewrite drops them), tests (Task 1). All spec sections map to a task.
- **Type consistency:** `GraphNode`/`GraphEdge`/`GraphIndex` defined in Task 1 are consumed unchanged in Task 3; `DependencyGraph` prop shape defined in Task 3 matches the call site in Task 4; `edgeKindFor` handles the `"sub_issue"` sentinel emitted by `buildGraphElements`.
- **No backend / Rust changes.** Everything is client-side over cached data.
