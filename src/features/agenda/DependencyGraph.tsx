import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
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
import { Search, X } from "lucide-react";
import { mountIssueMentionHoverCard } from "@/features/drawer/comments/IssueMentionPill";
import type { MentionTarget } from "@/features/drawer/markdownComponents";
import type { IssueListItem, Relation } from "@/lib/commands";
import { cn } from "@/lib/utils";
import type { AgendaItem } from "./agenda";

// ── Helpers ────────────────────────────────────────────────────────────────

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

/** Best-effort MentionTarget from partial relation-ref data. */
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

// ── Edge styling per relation type ───────────────────────────────────────────

type EdgeKind = {
  label: string;
  color: string;
  dashed?: boolean;
  animated?: boolean;
};

const SUB_ISSUE: EdgeKind = { label: "Sub-issue", color: "#6366f1", dashed: true };

const EDGE_KINDS: Record<string, EdgeKind> = {
  blocks: { label: "Blocks", color: "#ef4444", animated: true },
  blocked_by: { label: "Blocked by", color: "#f59e0b", animated: true },
  related: { label: "Related to", color: "#64748b", dashed: true },
  duplicate: { label: "Duplicate", color: "#a855f7", dashed: true },
  duplicate_of: { label: "Duplicate of", color: "#a855f7", dashed: true },
};

function edgeKind(type: string): EdgeKind {
  return EDGE_KINDS[type] ?? { label: type.replace(/_/g, " "), color: "#64748b", dashed: true };
}

/** Legend rows describing the edge encoding shown on the canvas. */
const LEGEND: EdgeKind[] = [SUB_ISSUE, EDGE_KINDS.blocks, EDGE_KINDS.blocked_by, EDGE_KINDS.related];

// ── Node data shape ─────────────────────────────────────────────────────────

type IssueNodeData = {
  identifier: string;
  title: string;
  stateColor: string;
  issueId: string;
  isRoot: boolean;
  /** Set while a search is active: highlighted match / dimmed non-match. */
  highlight?: boolean;
  dimmed?: boolean;
  mentionTarget: MentionTarget;
  onOpen: (id: string) => void;
};

const HANDLE_CLASS = "!size-1.5 !border !border-border !bg-muted-foreground/70";

/** Whether a node matches the (already-lowercased, non-empty) search term. */
function nodeMatches(data: IssueNodeData, term: string): boolean {
  return data.identifier.toLowerCase().includes(term) || data.title.toLowerCase().includes(term);
}

// ── Custom node component ───────────────────────────────────────────────────

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

  useEffect(() => {
    return () => {
      close();
    };
  }, [close]);

  return (
    <div
      ref={nodeRef}
      role="button"
      tabIndex={0}
      onMouseEnter={scheduleOpen}
      onMouseLeave={close}
      onClick={() => data.onOpen(data.issueId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          data.onOpen(data.issueId);
        }
      }}
      className={cn(
        "relative flex w-[200px] cursor-pointer flex-col gap-1 overflow-hidden rounded-lg border bg-card py-1.5 pl-3 pr-2.5 text-foreground shadow-sm transition-all hover:bg-accent focus-visible:outline-none",
        data.highlight
          ? "border-amber-400 ring-2 ring-amber-400"
          : data.isRoot
            ? "border-primary/40 ring-1 ring-primary/15"
            : "border-border",
        data.dimmed && "opacity-30",
      )}
    >
      {/* Status color: left accent bar + faint full tint */}
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
      <span className="relative truncate font-mono text-[11px] font-semibold">{data.identifier}</span>
      <span className="relative truncate text-[11px] leading-snug text-muted-foreground">{data.title}</span>
      <Handle type="source" position={Position.Right} className={HANDLE_CLASS} />
    </div>
  );
}

const NODE_TYPES: NodeTypes = {
  issueNode: IssueNode as unknown as NodeTypes["issueNode"],
};

// ── Node search ──────────────────────────────────────────────────────────────

/**
 * In-canvas search box. Lifts the query to the parent (which highlights/dims
 * nodes) and recenters the viewport on the matches as the term changes.
 */
function SearchPanel({
  query,
  setQuery,
  nodes,
}: {
  query: string;
  setQuery: (q: string) => void;
  nodes: Node[];
}) {
  const rf = useReactFlow();
  const term = query.trim().toLowerCase();

  useEffect(() => {
    if (!term) return;
    const matched = nodes
      .filter((n) => nodeMatches(n.data as IssueNodeData, term))
      .map((n) => ({ id: n.id }));
    if (matched.length) {
      rf.fitView({ nodes: matched, duration: 400, padding: 0.4, maxZoom: 1.5 });
    }
    // Recenter only when the term changes, not on every drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  return (
    <Panel position="top-left">
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
    </Panel>
  );
}

// ── Layout constants ────────────────────────────────────────────────────────

const NODE_WIDTH = 200;
const NODE_HEIGHT = 48;
const ROW_GAP = 48;
const COL_GAP = 360;

// ── Main component ──────────────────────────────────────────────────────────

type Props = {
  items: AgendaItem[];
  allIssues: IssueListItem[];
  onOpen: (id: string) => void;
};

export function DependencyGraph({ items, allIssues, onOpen }: Props) {
  const allIssuesById = useMemo(
    () => new Map(allIssues.map((i) => [i.id, i]),),
    [allIssues],
  );

  const base = useMemo(() => {
    // Collect all node data; prefer IssueListItem over relation-ref.
    const nodeMap = new Map<
      string,
      { identifier: string; title: string; stateColor: string; stateType: string; mentionTarget: MentionTarget; isRoot: boolean }
    >();

    const edgeList: Array<{
      source: string;
      target: string;
      kind: EdgeKind;
    }> = [];

    const addNode = (
      id: string,
      identifier: string,
      title: string,
      stateColor: string,
      stateType: string,
      mentionTarget: MentionTarget,
      isRoot: boolean,
    ) => {
      const existing = nodeMap.get(id);
      // Prefer: week root > child > allIssues lookup > relation partial
      if (!existing || (!existing.isRoot && isRoot)) {
        nodeMap.set(id, { identifier, title, stateColor, stateType, mentionTarget, isRoot });
      }
    };

    for (const item of items) {
      const full = allIssuesById.get(item.issue.id) ?? item.issue;
      addNode(
        item.issue.id,
        full.identifier,
        full.title,
        full.stateColor,
        full.stateType,
        toMentionTarget(full),
        true,
      );

      // Child nodes + parent→child edges
      for (const child of item.children) {
        const fullChild = allIssuesById.get(child.id) ?? child;
        addNode(
          child.id,
          fullChild.identifier,
          fullChild.title,
          fullChild.stateColor,
          fullChild.stateType,
          toMentionTarget(fullChild),
          false,
        );
        edgeList.push({ source: item.issue.id, target: child.id, kind: SUB_ISSUE });
      }

      // Related nodes + relation edges
      for (const rel of item.relations) {
        const fullRelated = allIssuesById.get(rel.relatedId);
        const mentionTarget = fullRelated
          ? toMentionTarget(fullRelated)
          : mentionTargetFromRelation(rel);
        addNode(
          rel.relatedId,
          fullRelated?.identifier ?? rel.relatedIdentifier ?? rel.relatedId,
          fullRelated?.title ?? rel.relatedTitle ?? rel.relatedId,
          fullRelated?.stateColor ?? rel.relatedStateColor ?? "#6B7280",
          fullRelated?.stateType ?? rel.relatedStateType ?? "unstarted",
          mentionTarget,
          false,
        );
        edgeList.push({ source: rel.issueId, target: rel.relatedId, kind: edgeKind(rel.type) });
      }
    }

    if (edgeList.length === 0) {
      return { nodes: [], edges: [] };
    }

    // Two-tier columnar layout: roots in left column, others in right column.
    const rootIds = new Set(items.map((it) => it.issue.id));
    const leftIds: string[] = [];
    const rightIds: string[] = [];

    for (const id of nodeMap.keys()) {
      if (rootIds.has(id)) {
        leftIds.push(id);
      } else {
        rightIds.push(id);
      }
    }

    const builtNodes: Node[] = [];

    leftIds.forEach((id, idx) => {
      const d = nodeMap.get(id)!;
      builtNodes.push({
        id,
        type: "issueNode",
        position: { x: 0, y: idx * (NODE_HEIGHT + ROW_GAP) },
        data: {
          identifier: d.identifier,
          title: d.title,
          stateColor: d.stateColor,
          issueId: id,
          isRoot: d.isRoot,
          mentionTarget: d.mentionTarget,
          onOpen,
        } satisfies IssueNodeData,
        width: NODE_WIDTH,
      });
    });

    rightIds.forEach((id, idx) => {
      const d = nodeMap.get(id)!;
      builtNodes.push({
        id,
        type: "issueNode",
        position: { x: COL_GAP, y: idx * (NODE_HEIGHT + ROW_GAP) },
        data: {
          identifier: d.identifier,
          title: d.title,
          stateColor: d.stateColor,
          issueId: id,
          isRoot: d.isRoot,
          mentionTarget: d.mentionTarget,
          onOpen,
        } satisfies IssueNodeData,
        width: NODE_WIDTH,
      });
    });

    const builtEdges: Edge[] = edgeList.map((e, i) => ({
      id: `e-${i}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      label: e.kind.label,
      animated: e.kind.animated ?? false,
      markerEnd: { type: MarkerType.ArrowClosed, color: e.kind.color, width: 16, height: 16 },
      style: {
        stroke: e.kind.color,
        strokeWidth: 1.5,
        strokeOpacity: 0.8,
        ...(e.kind.dashed ? { strokeDasharray: "5 4" } : {}),
      },
      labelStyle: { fontSize: 10, fontWeight: 500, fill: e.kind.color },
      labelShowBg: true,
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
      labelBgStyle: { fill: "var(--color-card)", fillOpacity: 0.95, stroke: e.kind.color, strokeOpacity: 0.35 },
    }));

    return { nodes: builtNodes, edges: builtEdges };
  }, [items, allIssuesById, onOpen]);

  // Controlled state so nodes can be dragged (positions persist on change).
  const [nodes, setNodes, onNodesChange] = useNodesState(base.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(base.edges);
  const [query, setQuery] = useState("");

  // Re-seed when the underlying graph changes (e.g. week / data changes).
  useEffect(() => {
    setNodes(base.nodes);
    setEdges(base.edges);
  }, [base, setNodes, setEdges]);

  // Apply search highlight/dim flags on top of the (draggable) node state.
  const term = query.trim().toLowerCase();
  const displayNodes = useMemo(() => {
    if (!term) return nodes;
    return nodes.map((n) => {
      const match = nodeMatches(n.data as IssueNodeData, term);
      return { ...n, data: { ...n.data, highlight: match, dimmed: !match } };
    });
  }, [nodes, term]);

  // Empty state: no edges (subsumes the no-items case)
  if (base.edges.length === 0) {
    return (
      <div className="flex h-full min-h-72 w-full items-center justify-center rounded-lg border border-border bg-card text-sm text-muted-foreground">
        No dependencies this week
      </div>
    );
  }

  return (
    <div className="h-full min-h-72 w-full overflow-hidden rounded-lg border border-border bg-card">
      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={NODE_TYPES}
        nodesDraggable
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.4}
        maxZoom={2}
        proOptions={{ hideAttribution: false }}
      >
        <SearchPanel query={query} setQuery={setQuery} nodes={nodes} />
        <Background gap={16} size={1} color="rgba(255,255,255,0.04)" />
        <Controls showInteractive={false} className="[&>button]:border-border [&>button]:bg-card [&>button]:text-foreground" />
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
