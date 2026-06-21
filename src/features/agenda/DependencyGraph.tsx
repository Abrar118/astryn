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
import { buildIndex, computeVisible, buildGraphElements, neighbors, buildGroups, type GroupBy } from "./graphModel";
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

const LEGEND: EdgeKind[] = [SUB_ISSUE, EDGE_KINDS.blocks, EDGE_KINDS.related];

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
          aria-label={data.expanded ? "Collapse neighbors" : `Expand ${data.hiddenCount} neighbor${data.hiddenCount !== 1 ? "s" : ""}`}
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
  const [groupBy, setGroupBy] = useState<GroupBy>("none");

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
    return { visible, ...buildGraphElements(visible, rootSet, index) };
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
      .filter((n) => n.type === "issueNode" && nodeMatches(n.data as IssueNodeData, term))
      .map((n) => ({ id: n.id }));
    if (matched.length) fitView({ nodes: matched, duration: 400, padding: 0.4, maxZoom: 1.5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  // Search highlight wins; otherwise selection drives the neighborhood focus.
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
          </div>
        </Panel>
        <Background gap={16} size={1} color="rgba(255,255,255,0.04)" />
        <Controls showInteractive={false} className="[&>button]:border-border [&>button]:bg-card [&>button]:text-foreground" />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => (n.type === "issueNode" ? (n.data as IssueNodeData).stateColor : "rgba(255,255,255,0.06)")}
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
