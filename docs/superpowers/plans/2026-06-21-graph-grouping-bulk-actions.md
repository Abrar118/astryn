# Dependency Graph — Grouping & Bulk Actions (Spec 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional grouping (Status/Project/Cycle sub-flows via elk nested layout) and multi-select bulk actions (Status/Assignee/Priority/Due) to the explorable dependency graph.

**Architecture:** Pure grouping/selection helpers extend `graphModel.ts` (unit-tested). `graphLayout.ts` gains a nested elk layout path. `DependencyGraph.tsx` adds a group-by selector + group container nodes (Group A) and React Flow native multi-select wired to a `BulkActionBar` that loops the existing `useUpdateIssue` mutation (Group B). Shared field constants move to `issueFields.ts`.

**Tech Stack:** React 19 + TypeScript (strict) + @xyflow/react v12 + elkjs + Vitest.

## Global Constraints

- TypeScript strict with `noUnusedLocals`/`noUnusedParameters` — no unused symbols.
- Dark-first Linear aesthetic; theme CSS variables (`var(--color-card)`, `border-border`, `text-muted-foreground`, etc.).
- All external API calls stay in Rust; the webview is a pure consumer (no API work here — bulk uses the existing `useUpdateIssue`).
- Group-by dimensions are exactly: None, Status, Project, Cycle. Bulk fields are exactly: Status, Assignee, Priority, Due date.
- Bulk **Status** is enabled only when all selected issues share one `teamId`; Priority/Assignee/Due are always enabled.
- Selection unifies on React Flow native selection: 0 = normal, 1 = neighborhood highlight, ≥2 = bulk bar.
- Group-by choice and selection are session state (not persisted).
- Use ripgrep (`rg`) for searches. Gate commands: `npx tsc --noEmit`, `npx vitest run`, `npm run build`. Branch: `m5-dependency-graph`.

---

## File Structure

- **Modify** `src/features/agenda/graphModel.ts` (+ `graphModel.test.ts`) — add `GroupBy`, `GraphGroup`, `groupKeyOf`, `buildGroups`, `bulkStatusTeamId`.
- **Modify** `src/features/agenda/graphLayout.ts` — add a nested (grouped) elk layout path; keep the flat path.
- **Modify** `src/features/agenda/DependencyGraph.tsx` — group-by selector + group node (Group A); selection wiring + bulk bar mount (Group B).
- **Create** `src/features/issues/issueFields.ts` (+ `issueFields.test.ts`) — shared `PRIORITIES`, `STATE_RANK`, `DUE_PRESETS`.
- **Modify** `src/features/issues/IssueContextMenu.tsx` — import the shared constants instead of local copies.
- **Create** `src/features/agenda/BulkActionBar.tsx` — the ≥2-selection toolbar.

Group A (grouping) = Tasks 1–3. Group B (bulk actions) = Tasks 4–6. The groups are independent; Task 1 also adds the bulk helper `bulkStatusTeamId` because it is pure graphModel logic and belongs with the other graphModel tests.

---

## Task 1: graphModel grouping + bulk helpers (pure, TDD)

**Files:**
- Modify: `src/features/agenda/graphModel.ts`
- Test: `src/features/agenda/graphModel.test.ts`

**Interfaces:**
- Consumes: existing `GraphIndex` (with `byId: Map<string, IssueListItem>`).
- Produces:
  - `type GroupBy = "none" | "status" | "project" | "cycle"`
  - `type GraphGroup = { id: string; label: string; memberIds: string[] }`
  - `groupKeyOf(issue: IssueListItem, groupBy: GroupBy): { key: string; label: string } | null`
  - `buildGroups(visibleIds: Set<string>, groupBy: GroupBy, index: GraphIndex): GraphGroup[]`
  - `bulkStatusTeamId(selectedIds: string[], index: GraphIndex): string | null`

- [ ] **Step 1: Write the failing tests**

Append to `src/features/agenda/graphModel.test.ts` (the file already has the `iss` fixture and imports from `./graphModel`):

```ts
import { groupKeyOf, buildGroups, bulkStatusTeamId } from "./graphModel";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/agenda/graphModel.test.ts`
Expected: FAIL — `groupKeyOf`/`buildGroups`/`bulkStatusTeamId` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/features/agenda/graphModel.ts`:

```ts
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
      return issue.stateId && issue.stateName
        ? { key: issue.stateId, label: issue.stateName }
        : { key: "_none", label: "No status" };
    case "project":
      return issue.projectId && issue.projectName
        ? { key: issue.projectId, label: issue.projectName }
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/agenda/graphModel.test.ts`
Expected: PASS (all new describe blocks + the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/features/agenda/graphModel.ts src/features/agenda/graphModel.test.ts
git commit -m "feat(graph): grouping + bulk-status pure helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: elk nested layout for groups

**Files:**
- Modify (replace contents): `src/features/agenda/graphLayout.ts`

**Interfaces:**
- Consumes: `GraphGroup` from `./graphModel`.
- Produces: `layoutGraph(nodes: Node[], edges: Edge[], groups?: GraphGroup[]): Promise<Node[]>` — when `groups` is empty/omitted, returns the flat layout (as today); when provided, returns group container nodes (`type: "group"`, absolute position + `style` width/height + `data: { label, count }`, `selectable: false`, `draggable: false`) **before** their member issue nodes (each given `parentId`, `extent: "parent"`, and a parent-relative `position`).

No unit test (async/elk/visual); verified by `npx tsc --noEmit` and downstream Task 3.

- [ ] **Step 1: Replace the file**

Replace the entire contents of `src/features/agenda/graphLayout.ts` with:

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/features/agenda/graphLayout.ts
git commit -m "feat(graph): elk nested layout for grouped sub-flows

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: DependencyGraph grouping integration

**Files:**
- Modify: `src/features/agenda/DependencyGraph.tsx`

**Interfaces:**
- Consumes: `buildGroups`, `type GroupBy` from `./graphModel`; `layoutGraph(nodes, edges, groups)` from `./graphLayout`.
- Produces: a `groupBy` selector + `group` node type rendered inside `DependencyGraphInner` (no exported-API change).

No unit test (visual); verified by tsc + build + manual checklist.

- [ ] **Step 1: Extend the graphModel import**

In `src/features/agenda/DependencyGraph.tsx`, replace:

```ts
import { buildIndex, computeVisible, buildGraphElements, neighbors } from "./graphModel";
```

with:

```ts
import { buildIndex, computeVisible, buildGraphElements, neighbors, buildGroups, type GroupBy } from "./graphModel";
```

- [ ] **Step 2: Add the GroupNode component + register the node type**

Replace:

```ts
const NODE_TYPES: NodeTypes = {
  issueNode: IssueNode as unknown as NodeTypes["issueNode"],
};
```

with:

```ts
type GroupNodeData = { label: string; count: number };

function GroupNode({ data }: { data: GroupNodeData }) {
  return (
    <div className="pointer-events-none h-full w-full rounded-xl border border-border/70 bg-muted/10">
      <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {data.label} <span className="text-muted-foreground/50">· {data.count}</span>
      </div>
    </div>
  );
}

const NODE_TYPES: NodeTypes = {
  issueNode: IssueNode as unknown as NodeTypes["issueNode"],
  group: GroupNode as unknown as NodeTypes["group"],
};

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "none", label: "None" },
  { value: "status", label: "Status" },
  { value: "project", label: "Project" },
  { value: "cycle", label: "Cycle" },
];
```

- [ ] **Step 3: Add the groupBy state**

In `DependencyGraphInner`, immediately after:

```ts
  const [query, setQuery] = useState("");
```

add:

```ts
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
```

- [ ] **Step 4: Expose the visible set from the elements memo**

Replace:

```ts
  const elements = useMemo(() => {
    const visible = computeVisible(rootIds, expandedIds, index);
    return buildGraphElements(visible, rootSet, index);
  }, [rootIds, expandedIds, index, rootSet]);
```

with:

```ts
  const elements = useMemo(() => {
    const visible = computeVisible(rootIds, expandedIds, index);
    return { visible, ...buildGraphElements(visible, rootSet, index) };
  }, [rootIds, expandedIds, index, rootSet]);
```

- [ ] **Step 5: Feed groups into the layout effect**

In the layout `useEffect`, replace:

```ts
    setEdges(rfEdges);
    const token = ++layoutToken.current;
    void layoutGraph(rfNodes, rfEdges).then((positioned) => {
      if (token !== layoutToken.current) return;
      setNodes(positioned);
      requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
    });
    // elements already depends on expandedIds; listing it too would double-fire the layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    elements,
    resolveDisplay,
    handleOpen,
    handleSelect,
    toggleExpand,
    handleContextMenu,
    setNodes,
    setEdges,
    fitView,
  ]);
```

with:

```ts
    setEdges(rfEdges);
    const groups = buildGroups(elements.visible, groupBy, indexRef.current);
    const token = ++layoutToken.current;
    void layoutGraph(rfNodes, rfEdges, groups).then((positioned) => {
      if (token !== layoutToken.current) return;
      setNodes(positioned);
      requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
    });
    // elements already depends on expandedIds; listing it too would double-fire the layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    elements,
    groupBy,
    resolveDisplay,
    handleOpen,
    handleSelect,
    toggleExpand,
    handleContextMenu,
    setNodes,
    setEdges,
    fitView,
  ]);
```

- [ ] **Step 6: Guard non-issue nodes in search + highlight**

Replace the search-recenter effect's filter line:

```ts
    const matched = nodes
      .filter((n) => nodeMatches(n.data as IssueNodeData, term))
      .map((n) => ({ id: n.id }));
```

with:

```ts
    const matched = nodes
      .filter((n) => n.type === "issueNode" && nodeMatches(n.data as IssueNodeData, term))
      .map((n) => ({ id: n.id }));
```

Then replace the whole `displayNodes` memo:

```ts
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
```

with:

```ts
  const displayNodes = useMemo(() => {
    if (term) {
      return nodes.map((n) =>
        n.type !== "issueNode"
          ? n
          : { ...n, data: { ...n.data, highlight: nodeMatches(n.data as IssueNodeData, term), dimmed: !nodeMatches(n.data as IssueNodeData, term) } },
      );
    }
    if (selectedId) {
      const nbrs = neighbors(selectedId, index);
      return nodes.map((n) =>
        n.type !== "issueNode"
          ? n
          : { ...n, data: { ...n.data, highlight: n.id === selectedId, dimmed: !(n.id === selectedId || nbrs.has(n.id)) } },
      );
    }
    return nodes;
  }, [nodes, term, selectedId, index]);
```

- [ ] **Step 7: Guard the MiniMap color for group nodes**

Replace:

```ts
          nodeColor={(n) => (n.data as IssueNodeData).stateColor}
```

with:

```ts
          nodeColor={(n) => (n.type === "issueNode" ? (n.data as IssueNodeData).stateColor : "rgba(255,255,255,0.06)")}
```

- [ ] **Step 8: Add the group-by selector to the top-left Panel**

In the top-left `<Panel position="top-left">`, the inner `<div className="flex items-center gap-2">` ends with the Re-layout `<button>…</button>`. Immediately after that closing `</button>` (still inside the flex div), add:

```tsx
            <div className="flex items-center gap-0.5 rounded-md border border-border bg-card/90 p-0.5 shadow-sm backdrop-blur">
              {GROUP_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setGroupBy(o.value)}
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px] transition-colors",
                    groupBy === o.value
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
```

- [ ] **Step 9: Typecheck, test, build**

Run: `npx tsc --noEmit` → Expected: CLEAN.
Run: `npx vitest run` → Expected: PASS (all files).
Run: `npm run build` → Expected: built OK (pre-existing chunk-size warning only).

- [ ] **Step 10: Commit**

```bash
git add src/features/agenda/DependencyGraph.tsx
git commit -m "feat(graph): group-by selector + sub-flow container nodes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Extract shared issue-field constants

**Files:**
- Create: `src/features/issues/issueFields.ts`
- Test: `src/features/issues/issueFields.test.ts`
- Modify: `src/features/issues/IssueContextMenu.tsx`

**Interfaces:**
- Produces:
  - `PRIORITIES: { value: number; label: string; color: string }[]`
  - `STATE_RANK: Record<string, number>`
  - `type DuePreset = { label: string; resolve: (today: string) => string | null }`
  - `DUE_PRESETS: DuePreset[]`

- [ ] **Step 1: Write the failing test**

Create `src/features/issues/issueFields.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PRIORITIES, DUE_PRESETS } from "./issueFields";

describe("issueFields", () => {
  it("exposes the five priorities with No priority last", () => {
    expect(PRIORITIES.map((p) => p.label)).toEqual([
      "Urgent",
      "High",
      "Medium",
      "Low",
      "No priority",
    ]);
  });
  it("resolves due presets relative to a given today", () => {
    const today = "2026-06-21";
    const byLabel = new Map(DUE_PRESETS.map((p) => [p.label, p.resolve(today)]));
    expect(byLabel.get("Today")).toBe("2026-06-21");
    expect(byLabel.get("Tomorrow")).toBe("2026-06-22");
    expect(byLabel.get("Next week")).toBe("2026-06-28");
    expect(byLabel.get("No due date")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/issues/issueFields.test.ts`
Expected: FAIL — cannot find module `./issueFields`.

- [ ] **Step 3: Implement the module**

Create `src/features/issues/issueFields.ts`:

```ts
import { addDays } from "@/lib/dates";

/** Linear priority values (0 = none) with display label + color. */
export const PRIORITIES = [
  { value: 1, label: "Urgent", color: "#ef4444" },
  { value: 2, label: "High", color: "#f97316" },
  { value: 3, label: "Medium", color: "#eab308" },
  { value: 4, label: "Low", color: "#3b82f6" },
  { value: 0, label: "No priority", color: "#6b7280" },
];

/** Workflow-state ordering for sorting state lists. */
export const STATE_RANK: Record<string, number> = {
  backlog: 0,
  unstarted: 1,
  started: 2,
  completed: 3,
  canceled: 4,
};

export type DuePreset = { label: string; resolve: (today: string) => string | null };

/** Quick due-date choices, resolved against a Dhaka `today` (YYYY-MM-DD). */
export const DUE_PRESETS: DuePreset[] = [
  { label: "Today", resolve: (t) => t },
  { label: "Tomorrow", resolve: (t) => addDays(t, 1) },
  { label: "Next week", resolve: (t) => addDays(t, 7) },
  { label: "No due date", resolve: () => null },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/issues/issueFields.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor IssueContextMenu to use the shared constants**

In `src/features/issues/IssueContextMenu.tsx`:

(a) Add to the imports (near the other `@/` imports):

```ts
import { PRIORITIES, STATE_RANK, DUE_PRESETS } from "@/features/issues/issueFields";
```

(b) Delete the local `const PRIORITIES = [ … ];` block and the local `const STATE_RANK: Record<string, number> = { … };` block (now imported).

(c) Delete the local `function addDays(ymd: string, n: number): string { … }` helper (the due rows will use `DUE_PRESETS`, and no other code in the file calls it — confirm with `rg -n "addDays" src/features/issues/IssueContextMenu.tsx` returning no other uses before deleting).

(d) Replace the four hard-coded due-date `<Row>` entries inside the "Due date" submenu:

```tsx
            <Row icon={<Calendar className="size-4" />} label="Today" onClick={() => patch({ dueDate: today })} />
            <Row icon={<Calendar className="size-4" />} label="Tomorrow" onClick={() => patch({ dueDate: addDays(today, 1) })} />
            <Row icon={<Calendar className="size-4" />} label="Next week" onClick={() => patch({ dueDate: addDays(today, 7) })} />
            <Row
              icon={<Calendar className="size-4" />}
              label="No due date"
              active={!issue.dueDate}
              onClick={() => patch({ dueDate: null })}
            />
```

with:

```tsx
            {DUE_PRESETS.map((p) => (
              <Row
                key={p.label}
                icon={<Calendar className="size-4" />}
                label={p.label}
                active={p.label === "No due date" ? !issue.dueDate : undefined}
                onClick={() => patch({ dueDate: p.resolve(today) })}
              />
            ))}
```

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit` → Expected: CLEAN (no unused-symbol errors from the deletions).
Run: `npx vitest run` → Expected: PASS (issueFields tests + existing suite).

- [ ] **Step 7: Commit**

```bash
git add src/features/issues/issueFields.ts src/features/issues/issueFields.test.ts src/features/issues/IssueContextMenu.tsx
git commit -m "refactor(issues): extract shared PRIORITIES/STATE_RANK/DUE_PRESETS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: BulkActionBar component

**Files:**
- Create: `src/features/agenda/BulkActionBar.tsx`

**Interfaces:**
- Consumes: `bulkStatusTeamId` + `GraphIndex` from `./graphModel`; `PRIORITIES`, `STATE_RANK`, `DUE_PRESETS` from `@/features/issues/issueFields`; `useUsers`, `useUpdateIssue` from `@/lib/queries`; `dhakaToday` from `@/lib/dates`; `gooeyToast` from `goey-toast`.
- Produces: `BulkActionBar({ selectedIds: string[]; index: GraphIndex; onClear: () => void })` — the toolbar body (the caller wraps it in a `<Panel>`).

No unit test (UI; the pure `bulkStatusTeamId` is covered in Task 1). Verified by tsc + build.

- [ ] **Step 1: Create the component**

Create `src/features/agenda/BulkActionBar.tsx`:

```tsx
import { useMemo, useState } from "react";
import { gooeyToast } from "goey-toast";
import { CalendarClock, Check, SignalHigh, User as UserIcon, X } from "lucide-react";
import { useUsers, useUpdateIssue } from "@/lib/queries";
import { dhakaToday } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { UpdateIssuePatch } from "@/lib/commands";
import { PRIORITIES, STATE_RANK, DUE_PRESETS } from "@/features/issues/issueFields";
import { bulkStatusTeamId, type GraphIndex } from "./graphModel";

type MenuKey = "status" | "assignee" | "priority" | "due";

export function BulkActionBar({
  selectedIds,
  index,
  onClear,
}: {
  selectedIds: string[];
  index: GraphIndex;
  onClear: () => void;
}) {
  const { data: users } = useUsers();
  const update = useUpdateIssue();
  const [open, setOpen] = useState<MenuKey | null>(null);

  const teamId = bulkStatusTeamId(selectedIds, index);
  const teamStates = useMemo(() => {
    if (!teamId) return [];
    const seen = new Map<string, { id: string; name: string; type: string; color: string }>();
    for (const i of index.byId.values()) {
      if (i.teamId === teamId && i.stateId && i.stateName) {
        seen.set(i.stateId, { id: i.stateId, name: i.stateName, type: i.stateType, color: i.stateColor });
      }
    }
    return [...seen.values()].sort((a, b) => (STATE_RANK[a.type] ?? 9) - (STATE_RANK[b.type] ?? 9));
  }, [teamId, index]);

  const apply = (patch: UpdateIssuePatch, label: string) => {
    for (const id of selectedIds) update.mutate({ id, patch });
    gooeyToast.success(`${label} · ${selectedIds.length} issue${selectedIds.length !== 1 ? "s" : ""}`);
    setOpen(null);
  };

  const toggle = (k: MenuKey) => setOpen((cur) => (cur === k ? null : k));

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-card/95 px-2 py-1 text-xs shadow-xl backdrop-blur">
      <span className="px-1 font-medium text-foreground">{selectedIds.length} selected</span>
      <span className="mx-0.5 h-4 w-px bg-border" />

      <BarButton icon={<Check className="size-3.5" />} label="Status" disabled={!teamId} title={teamId ? undefined : "Select issues from one team to set status"} onClick={() => toggle("status")} open={open === "status"}>
        {teamStates.length === 0 ? (
          <Empty>No states</Empty>
        ) : (
          teamStates.map((s) => (
            <Item key={s.id} onClick={() => apply({ stateId: s.id }, s.name)}>
              <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.name}
            </Item>
          ))
        )}
      </BarButton>

      <BarButton icon={<UserIcon className="size-3.5" />} label="Assignee" onClick={() => toggle("assignee")} open={open === "assignee"}>
        <Item onClick={() => apply({ assigneeId: null }, "Unassigned")}>
          <span className="size-3.5 rounded-full border border-dashed border-border" />
          Unassigned
        </Item>
        {(users ?? []).map((u) => (
          <Item key={u.id} onClick={() => apply({ assigneeId: u.id }, u.name)}>
            <span className="size-3.5 rounded-full bg-muted" />
            {u.name}
          </Item>
        ))}
      </BarButton>

      <BarButton icon={<SignalHigh className="size-3.5" />} label="Priority" onClick={() => toggle("priority")} open={open === "priority"}>
        {PRIORITIES.map((p) => (
          <Item key={p.value} onClick={() => apply({ priority: p.value }, p.label)}>
            <span className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />
            {p.label}
          </Item>
        ))}
      </BarButton>

      <BarButton icon={<CalendarClock className="size-3.5" />} label="Due" onClick={() => toggle("due")} open={open === "due"}>
        {DUE_PRESETS.map((p) => (
          <Item key={p.label} onClick={() => apply({ dueDate: p.resolve(dhakaToday()) }, p.label)}>
            {p.label}
          </Item>
        ))}
      </BarButton>

      <span className="mx-0.5 h-4 w-px bg-border" />
      <button
        type="button"
        aria-label="Clear selection"
        onClick={onClear}
        className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function BarButton({
  icon,
  label,
  open,
  disabled,
  title,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  open: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        title={title}
        onClick={onClick}
        className={cn(
          "flex items-center gap-1 rounded px-1.5 py-1 text-muted-foreground transition-colors",
          disabled ? "cursor-not-allowed opacity-40" : "hover:bg-accent hover:text-foreground",
          open && "bg-accent text-foreground",
        )}
      >
        {icon}
        {label}
      </button>
      {open && !disabled && (
        <div className="absolute bottom-full left-0 mb-1 max-h-64 w-44 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-2xl">
          {children}
        </div>
      )}
    </div>
  );
}

function Item({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-accent"
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 py-1.5 text-[12px] text-muted-foreground">{children}</div>;
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit` → Expected: CLEAN.
Run: `npm run build` → Expected: built OK.

- [ ] **Step 3: Commit**

```bash
git add src/features/agenda/BulkActionBar.tsx
git commit -m "feat(graph): bulk action bar (status/assignee/priority/due)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Wire multi-select + mount the bulk bar + final gate

**Files:**
- Modify: `src/features/agenda/DependencyGraph.tsx`

**Interfaces:**
- Consumes: `BulkActionBar` from `./BulkActionBar`.
- Produces: React Flow native selection driving the neighborhood highlight (1) and the bulk bar (≥2); the per-node custom `onSelect` is removed.

No unit test (visual); verified by tsc + build + manual checklist.

- [ ] **Step 1: Import the bulk bar**

Add to the imports in `src/features/agenda/DependencyGraph.tsx`:

```ts
import { BulkActionBar } from "./BulkActionBar";
```

- [ ] **Step 2: Remove the custom single-select path (replaced by RF native selection)**

(a) In `type IssueNodeData`, delete the line:

```ts
  onSelect: (id: string) => void;
```

(b) In `IssueNode`'s root `<div>`, delete the line:

```ts
      onClick={() => data.onSelect(data.issueId)}
```

(c) In `DependencyGraphInner`, replace:

```ts
  const [selectedId, setSelectedId] = useState<string | null>(null);
```

with:

```ts
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const onSelectionChange = useCallback(
    (params: { nodes: Node[] }) =>
      setSelectedIds(params.nodes.filter((n) => n.type === "issueNode").map((n) => n.id)),
    [],
  );
```

(d) Delete the now-unused handler:

```ts
  const handleSelect = useCallback((id: string) => setSelectedId(id), []);
```

(e) In the layout effect's node-data object, delete the line:

```ts
          onSelect: handleSelect,
```

and remove `handleSelect` from that effect's dependency array.

- [ ] **Step 3: Drive highlight from selection count**

Replace the `displayNodes` memo (the version produced by Task 3 Step 6) with:

```ts
  const displayNodes = useMemo(() => {
    if (term) {
      return nodes.map((n) =>
        n.type !== "issueNode"
          ? n
          : { ...n, data: { ...n.data, highlight: nodeMatches(n.data as IssueNodeData, term), dimmed: !nodeMatches(n.data as IssueNodeData, term) } },
      );
    }
    if (selectedIds.length === 1) {
      const focus = selectedIds[0];
      const nbrs = neighbors(focus, index);
      return nodes.map((n) =>
        n.type !== "issueNode"
          ? n
          : { ...n, data: { ...n.data, highlight: n.id === focus, dimmed: !(n.id === focus || nbrs.has(n.id)) } },
      );
    }
    return nodes;
  }, [nodes, term, selectedIds, index]);
```

- [ ] **Step 4: Add the clear-selection callback**

After the `relayout` callback, add:

```ts
  const clearSelection = useCallback(() => {
    setNodes((ns) => ns.map((n) => ({ ...n, selected: false })));
    setSelectedIds([]);
  }, [setNodes]);
```

- [ ] **Step 5: Wire onSelectionChange + drop the old pane-click handler**

On the `<ReactFlow>` element, replace:

```tsx
        onPaneClick={() => setSelectedId(null)}
```

with:

```tsx
        onSelectionChange={onSelectionChange}
```

(Left-drag keeps panning, per React Flow defaults; **Shift+click** adds a node to the selection and **Shift+drag** draws a selection box — the default `selectionKeyCode` is Shift. A plain pane click natively clears the selection, which fires `onSelectionChange` with `[]`. No `panOnDrag`/`selectionOnDrag` overrides.)

- [ ] **Step 6: Mount the bulk bar at ≥2 selected**

Immediately after the opening `<ReactFlow … >` children begin (before `<Panel position="top-left">`), add:

```tsx
        {selectedIds.length >= 2 && (
          <Panel position="bottom-center">
            <BulkActionBar selectedIds={selectedIds} index={index} onClear={clearSelection} />
          </Panel>
        )}
```

- [ ] **Step 7: Typecheck, full suite, build**

Run: `npx tsc --noEmit` → Expected: CLEAN (no unused `selectedId`/`handleSelect`/`onSelect`).
Run: `npx vitest run` → Expected: PASS (all files).
Run: `npm run build` → Expected: built OK (pre-existing chunk-size warning only).

- [ ] **Step 8: Manual verification checklist** (needs the running app — `npm run tauri dev`, open Dependencies)

- Group-by None/Status/Project/Cycle: choosing one boxes visible issues into labelled containers with counts; None restores the flat layout; expand/collapse re-groups.
- Cross-group edges still render with arrows/labels.
- Shift+click and Shift+drag box select multiple nodes; selecting ≥2 shows the bulk bar (bottom-center); 1 shows the neighborhood highlight; pane click clears.
- Bulk Status disabled (greyed, tooltip) when selection spans teams; enabled with the team's states when they share one. Priority/Assignee/Due always work; each applies to all selected with a toast.
- Single-select highlight, double-click drawer, right-click menu, search, MiniMap, Re-layout all still work.

- [ ] **Step 9: Commit**

```bash
git add src/features/agenda/DependencyGraph.tsx
git commit -m "feat(graph): multi-select bulk actions via RF native selection

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** grouping dimensions + selector + container nodes + nested layout (Tasks 1–3); bulk Status/Assignee/Priority/Due via RF native selection + bar + team-scoped Status (Tasks 4–6); shared `PRIORITIES`/due presets extracted once (Task 4, consumed in Task 5). Catch-all groups, team-scoping, and `groupKeyOf` fallbacks are in Task 1's tests.
- **Type consistency:** `GroupBy`/`GraphGroup`/`buildGroups`/`bulkStatusTeamId` (Task 1) are consumed unchanged by `layoutGraph` (Task 2), `DependencyGraph` (Task 3, 6), and `BulkActionBar` (Task 5). `DuePreset.resolve` is named consistently across `issueFields.ts`, its test, the context-menu refactor, and the bulk bar. The `group` node type string matches between `layoutGraph` output, `NODE_TYPES`, and the `n.type === "issueNode"` guards.
- **Ordering:** Task 3 leaves the file with the `selectedId` single-select path; Task 6 removes it. Both edits are anchored to the exact current text. Group A (1–3) and Group B (4–6) are independently reviewable; Task 5 depends on Task 4's `issueFields.ts`, and Task 6 depends on Task 5's `BulkActionBar`.
- **No backend / Rust changes.**
