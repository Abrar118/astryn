import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type NodeTypes,
  type Node,
  type Edge,
} from "@xyflow/react";
import { mountIssueMentionHoverCard } from "@/features/drawer/comments/IssueMentionPill";
import type { MentionTarget } from "@/features/drawer/markdownComponents";
import type { IssueListItem, Relation } from "@/lib/commands";
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

function humanizeRelationType(type: string): string {
  switch (type) {
    case "blocks":
      return "blocks";
    case "blocked_by":
      return "blocked by";
    case "duplicate":
      return "duplicate";
    case "duplicate_of":
      return "duplicate of";
    default:
      return type.replace(/_/g, " ");
  }
}

// ── Node data shape ─────────────────────────────────────────────────────────

type IssueNodeData = {
  identifier: string;
  title: string;
  stateColor: string;
  issueId: string;
  mentionTarget: MentionTarget;
  onOpen: (id: string) => void;
};

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
      className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs font-mono text-foreground shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: data.stateColor }}
      />
      <span className="max-w-[120px] truncate">{data.identifier}</span>
    </div>
  );
}

const NODE_TYPES: NodeTypes = {
  issueNode: IssueNode as unknown as NodeTypes["issueNode"],
};

// ── Layout constants ────────────────────────────────────────────────────────

const NODE_WIDTH = 160;
const NODE_HEIGHT = 32;
const ROW_GAP = 56;
const COL_GAP = 240;

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

  const { nodes, edges } = useMemo(() => {
    // Collect all node data; prefer IssueListItem over relation-ref.
    const nodeMap = new Map<
      string,
      { identifier: string; title: string; stateColor: string; stateType: string; mentionTarget: MentionTarget; isRoot: boolean }
    >();

    const edgeList: Array<{
      source: string;
      target: string;
      label: string;
      dashed: boolean;
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
        edgeList.push({
          source: item.issue.id,
          target: child.id,
          label: "sub-issue",
          dashed: true,
        });
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
        edgeList.push({
          source: rel.issueId,
          target: rel.relatedId,
          label: humanizeRelationType(rel.type),
          dashed: false,
        });
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
      label: e.label,
      style: {
        stroke: "rgba(144, 164, 174, 0.6)",
        strokeWidth: 1.5,
        ...(e.dashed ? { strokeDasharray: "4 3" } : {}),
      },
      labelStyle: { fontSize: 10, fill: "rgba(144, 164, 174, 0.8)" },
      labelBgStyle: { fill: "transparent" },
    }));

    return { nodes: builtNodes, edges: builtEdges };
  }, [items, allIssuesById, onOpen]);

  // Empty state: no items at all, or items exist but no edges
  if (items.length === 0 || edges.length === 0) {
    return (
      <div className="flex h-72 w-full items-center justify-center rounded-lg border border-border bg-card text-sm text-muted-foreground">
        No dependencies this week
      </div>
    );
  }

  return (
    <div className="h-72 w-full overflow-hidden rounded-lg border border-border bg-card">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.4}
        maxZoom={2}
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={16} size={1} color="rgba(255,255,255,0.04)" />
        <Controls showInteractive={false} className="[&>button]:border-border [&>button]:bg-card [&>button]:text-foreground" />
      </ReactFlow>
    </div>
  );
}
