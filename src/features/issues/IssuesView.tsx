import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  Box,
  CalendarDays,
  ChevronDown,
  Gauge,
  GitPullRequest,
  IterationCcw,
  LayoutGrid,
  Link2,
  List as ListIcon,
  Milestone,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { useFilterOptions, useIssues, useMe, useUpdateIssue, useUsers, useWorkflowStates } from "@/lib/queries";
import { dhakaDateFromTimestamp, dhakaToday, isOverdue } from "@/lib/dates";
import type { IssueListItem, IssueFilters, UpdateIssuePatch, WorkflowState } from "@/lib/commands";
import { Avatar } from "@/components/Avatar";
import { AssigneeSelect } from "@/components/AssigneeSelect";
import { useIssueMenu } from "./IssueContextMenu";
import {
  DEFAULT_DISPLAY,
  VIEW_KEY,
  parseViewConfig,
  type Completed,
  type DisplayProps,
  type GroupBy,
  type Ordering,
  type ViewConfig,
  type ViewMode,
} from "./viewConfig";
import {
  IssueRow,
  LabelPills,
  Pill,
  PriorityIcon,
  compareIssues,
  cycleText,
  dueLabel,
  fmtDate,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  STATE_RANK,
} from "./IssueRow";
import { StatusIcon } from "../drawer/issueGlyphs";
import { DisplayOptions, miniSelect } from "./DisplayOptions";

function loadConfig(): ViewConfig {
  return parseViewConfig(localStorage.getItem(VIEW_KEY));
}

// ── Grouping & ordering ──────────────────────────────────────────────────────

type Group = { key: string; label: string; color?: string; type?: string; issues: IssueListItem[]; rank: number };

function groupIssues(
  issues: IssueListItem[],
  by: GroupBy,
  usersById: Map<string, string>,
  states: WorkflowState[],
): Group[] {
  if (by === "none") return [{ key: "all", label: "All issues", issues, rank: 0 }];
  const map = new Map<string, Group>();
  if (by === "status") {
    for (const state of states) {
      if (!map.has(state.name)) {
        map.set(state.name, {
          key: state.name,
          label: state.name,
          color: state.color,
          type: state.type,
          issues: [],
          rank: STATE_RANK[state.type] ?? 9,
        });
      }
    }
  }
  for (const i of issues) {
    let key: string;
    let label: string;
    let color: string | undefined;
    let type: string | undefined;
    let rank: number;
    if (by === "status") {
      key = i.stateName || i.stateType || "none";
      label = i.stateName || "No status";
      color = i.stateColor || undefined;
      type = i.stateType;
      rank = STATE_RANK[i.stateType] ?? 9;
    } else if (by === "assignee") {
      key = i.assigneeId ?? "none";
      label = i.assigneeName || (i.assigneeId ? usersById.get(i.assigneeId) ?? "Unknown" : "No assignee");
      rank = i.assigneeId ? 0 : 9;
    } else if (by === "priority") {
      key = String(i.priority);
      label = PRIORITY_LABELS[i.priority] ?? "No priority";
      color = PRIORITY_COLORS[i.priority];
      rank = PRIORITY_ORDER.indexOf(i.priority);
    } else {
      key = i.projectId ?? "none";
      label = i.projectName || "No project";
      rank = i.projectId ? 0 : 9;
    }
    let g = map.get(key);
    if (!g) {
      g = { key, label, color, type, issues: [], rank };
      map.set(key, g);
    }
    g.issues.push(i);
  }
  return [...map.values()].sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
}

// ── Rows & cards ─────────────────────────────────────────────────────────────

type AvatarInfo = { name: string } | null;

function BoardCard({
  issue,
  display,
  avatar,
  today,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onContextMenu,
  dragging,
}: {
  issue: IssueListItem;
  display: DisplayProps;
  avatar: AvatarInfo;
  today: string;
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: (e: ReactPointerEvent) => void;
  onPointerCancel: () => void;
  onContextMenu: (e: ReactMouseEvent) => void;
  dragging?: boolean;
}) {
  const overdue = isOverdue(issue.dueDate, issue.stateType, today);
  const cycle = cycleText(issue);
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onContextMenu={onContextMenu}
      style={{ touchAction: "none" }}
      className={`cursor-grab touch-none select-none rounded-lg border border-border bg-card p-3 transition-colors hover:border-foreground/25 active:cursor-grabbing ${
        dragging ? "opacity-40" : ""
      }`}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[11px] text-muted-foreground">{display.id ? issue.identifier : ""}</span>
        {display.assignee &&
          (avatar ? (
            <Avatar name={avatar.name} size={18} />
          ) : (
            <span className="size-[18px] shrink-0 rounded-full border border-dashed border-border" />
          ))}
      </div>
      <div className="mb-2 line-clamp-2 text-[13px] font-medium leading-snug text-foreground">{issue.title}</div>
      {display.labels && issue.labels.length > 0 && (
        <div className="mb-2">
          <LabelPills labels={issue.labels} max={3} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {display.priority && <PriorityIcon p={issue.priority} />}
        {display.project && issue.projectName && (
          <Pill>
            <Box className="size-3" />
            <span className="max-w-32 truncate">{issue.projectName}</span>
          </Pill>
        )}
        {display.milestone && issue.milestoneName && (
          <Pill>
            <Milestone className="size-3" />
            <span className="max-w-28 truncate">{issue.milestoneName}</span>
          </Pill>
        )}
        {display.cycle && cycle && (
          <Pill>
            <IterationCcw className="size-3" />
            {cycle}
          </Pill>
        )}
        {display.estimate && issue.estimate != null && (
          <Pill>
            <Gauge className="size-3" />
            {issue.estimate}
          </Pill>
        )}
        {display.pullRequests && issue.prCount > 0 && (
          <Pill>
            <GitPullRequest className="size-3" />
            {issue.prCount}{issue.attachmentsTruncated ? "+" : ""}
          </Pill>
        )}
        {display.links && issue.linkCount > 0 && (
          <Pill>
            <Link2 className="size-3" />
            {issue.linkCount}{issue.attachmentsTruncated ? "+" : ""}
          </Pill>
        )}
        {display.dueDate && issue.dueDate && (
          <Pill className={overdue ? "border-red-500/40 text-red-400" : ""}>
            <CalendarDays className="size-3" />
            {dueLabel(issue.dueDate, today)}
          </Pill>
        )}
      </div>
      {display.created && (
        <div className="mt-2 text-[11px] text-muted-foreground">Created {fmtDate(dhakaDateFromTimestamp(issue.createdAt))}</div>
      )}
    </div>
  );
}

function GroupHeading({ group }: { group: Group }) {
  return (
    <>
      {group.type ? (
        <StatusIcon type={group.type} color={group.color || "#6b7280"} />
      ) : group.color ? (
        <span className="size-2.5 rounded-full" style={{ backgroundColor: group.color }} />
      ) : null}
      <span>{group.label}</span>
      <span className="rounded bg-secondary/60 px-1.5 text-[11px] text-muted-foreground">{group.issues.length}</span>
    </>
  );
}

// ── Options popover ──────────────────────────────────────────────────────────

function Popover({
  trigger,
  children,
}: {
  trigger: (open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="cursor-pointer">
        {trigger(open)}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-border bg-popover p-3 shadow-2xl">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function ToggleRow({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={onClick}
        className={`relative h-4 w-7 cursor-pointer rounded-full transition-colors ${on ? "bg-primary" : "bg-secondary"}`}
      >
        <span className={`absolute top-0.5 size-3 rounded-full bg-white transition-transform ${on ? "translate-x-3.5" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

// ── View ─────────────────────────────────────────────────────────────────────

export function IssuesView() {
  const today = dhakaToday();
  const me = useMe();
  const { data: issues } = useIssues({});
  const { data: filterOpts } = useFilterOptions();
  const { data: users } = useUsers();
  const { data: workflowStates } = useWorkflowStates();
  const update = useUpdateIssue();
  const { openMenu } = useIssueMenu();
  const [, setParams] = useSearchParams();

  const cfg = useRef<ViewConfig | null>(null);
  if (!cfg.current) cfg.current = loadConfig();
  const [filters, setFilters] = useState<IssueFilters>(cfg.current.filters);
  const [groupBy, setGroupBy] = useState<GroupBy>(cfg.current.groupBy);
  const [viewMode, setViewMode] = useState<ViewMode>(cfg.current.viewMode);
  const [ordering, setOrdering] = useState<Ordering>(cfg.current.ordering);
  const [completed, setCompleted] = useState<Completed>(cfg.current.completed);
  const [showSubIssues, setShowSubIssues] = useState(cfg.current.showSubIssues);
  const [display, setDisplay] = useState<DisplayProps>(cfg.current.display);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ title: string; x: number; y: number } | null>(null);
  const gesture = useRef<{ id: string; title: string; x: number; y: number; started: boolean } | null>(null);

  // Persist the view config (filters + display options) across reloads/launches.
  useEffect(() => {
    try {
      localStorage.setItem(
        VIEW_KEY,
        JSON.stringify({ filters, groupBy, viewMode, ordering, completed, showSubIssues, display }),
      );
    } catch {
      // Storage unavailable — keep in-memory state only.
    }
  }, [filters, groupBy, viewMode, ordering, completed, showSubIssues, display]);

  const usersById = useMemo(() => new Map((users ?? []).map((u) => [u.id, u.name])), [users]);
  const avatarOf = (id: string | null): AvatarInfo => {
    if (!id) return null;
    const u = (users ?? []).find((x) => x.id === id);
    return u ? { name: u.name } : null;
  };

  const visible = useMemo(() => {
    let arr = (issues ?? []).filter(
      (i) =>
        (!filters.teamId || i.teamId === filters.teamId) &&
        (!filters.assigneeId || i.assigneeId === filters.assigneeId) &&
        (!filters.projectId || i.projectId === filters.projectId),
    );
    if (completed === "active") arr = arr.filter((i) => i.stateType !== "completed" && i.stateType !== "canceled");
    if (!showSubIssues) arr = arr.filter((i) => !i.parentId);
    return arr;
  }, [issues, filters, completed, showSubIssues]);

  const groups = useMemo(() => {
    const applicableStates = (workflowStates ?? []).filter((state) => !filters.teamId || state.teamId === filters.teamId);
    const gs = groupIssues(visible, groupBy, usersById, applicableStates);
    for (const g of gs) g.issues.sort((a, b) => compareIssues(a, b, ordering));
    return gs;
  }, [visible, groupBy, ordering, usersById, workflowStates, filters.teamId]);

  const open = (id: string) => setParams({ issue: id });

  // ── Board drag & drop ──────────────────────────────────────────────────────
  // Dropping a card into another column applies the patch implied by the current
  // grouping. Status is team-scoped in Linear, so we resolve the target stateId
  // from a sibling issue of the SAME team already in that status.
  const statesByTeamName = useMemo(() => {
    const m = new Map<string, string>();
    for (const state of workflowStates ?? []) {
      m.set(`${state.teamId}::${state.name}`, state.id);
    }
    return m;
  }, [workflowStates]);
  const dndEnabled = groupBy === "status" || groupBy === "assignee" || groupBy === "priority";

  const patchForDrop = (issue: IssueListItem, g: Group): UpdateIssuePatch | null => {
    if (groupBy === "assignee") {
      const target = g.key === "none" ? null : g.key;
      return issue.assigneeId === target ? null : { assigneeId: target };
    }
    if (groupBy === "priority") {
      const target = Number(g.key);
      return issue.priority === target ? null : { priority: target };
    }
    if (groupBy === "status") {
      const stateId = issue.teamId ? statesByTeamName.get(`${issue.teamId}::${g.label}`) : undefined;
      return !stateId || stateId === issue.stateId ? null : { stateId };
    }
    return null;
  };

  // Pointer-event dragging. Native HTML5 drag-and-drop does not deliver `drop`
  // events in WKWebView (Tauri), so we drive the gesture manually — the same
  // reason FullCalendar uses pointer events. A small movement threshold keeps a
  // plain click opening the drawer.
  const DRAG_THRESHOLD = 6;

  const groupKeyAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return el?.closest<HTMLElement>("[data-group-key]")?.dataset.groupKey ?? null;
  };

  const onCardPointerDown = (e: ReactPointerEvent, issue: IssueListItem) => {
    if (e.button !== 0) return;
    gesture.current = { id: issue.id, title: issue.title, x: e.clientX, y: e.clientY, started: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onCardPointerMove = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (!g.started) {
      if (!dndEnabled) return;
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < DRAG_THRESHOLD) return;
      g.started = true;
      setDraggingId(g.id);
    }
    setGhost({ title: g.title, x: e.clientX, y: e.clientY });
    setDragOverKey(groupKeyAt(e.clientX, e.clientY));
  };

  const onCardPointerUp = (e: ReactPointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    setDraggingId(null);
    setDragOverKey(null);
    setGhost(null);
    if (!g) return;
    if (!g.started) {
      open(g.id); // below threshold => treat as a click
      return;
    }
    const key = groupKeyAt(e.clientX, e.clientY);
    const target = key ? groups.find((gr) => gr.key === key) : null;
    if (!target) return;
    const issue = (issues ?? []).find((i) => i.id === g.id);
    if (!issue) return;
    const patch = patchForDrop(issue, target);
    if (patch) update.mutate({ id: g.id, patch });
  };

  const cancelCardGesture = () => {
    gesture.current = null;
    setDraggingId(null);
    setDragOverKey(null);
    setGhost(null);
  };

  const reset = () => {
    setGroupBy("status");
    setViewMode("list");
    setOrdering("status");
    setCompleted("all");
    setShowSubIssues(true);
    setDisplay(DEFAULT_DISPLAY);
  };

  const sel =
    "cursor-pointer appearance-none rounded-md border border-border bg-secondary/40 py-1.5 pl-2.5 pr-7 text-xs font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="flex h-full flex-col gap-3 p-4 pb-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-sm font-semibold text-foreground">
          Issues <span className="text-muted-foreground">{visible.length}</span>
        </h1>
        <AssigneeSelect
          value={filters.assigneeId ?? null}
          onChange={(id) => setFilters((f) => ({ ...f, assigneeId: id ?? undefined }))}
          users={users ?? []}
          meId={me.data?.viewerId}
          emptyLabel="All assignees"
        />
        <div className="relative">
          <select
            className={sel}
            value={filters.teamId ?? "__all"}
            onChange={(e) => setFilters((f) => ({ ...f, teamId: e.target.value === "__all" ? undefined : e.target.value }))}
          >
            <option value="__all">All teams</option>
            {filterOpts?.teams.map((t) => (
              <option key={t.id} value={t.id}>{t.key}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>
        <div className="relative">
          <select
            className={sel}
            value={filters.projectId ?? "__all"}
            onChange={(e) => setFilters((f) => ({ ...f, projectId: e.target.value === "__all" ? undefined : e.target.value }))}
          >
            <option value="__all">All projects</option>
            {filterOpts?.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>

        <div className="ml-auto">
          <Popover
            trigger={() => (
              <span className="flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent">
                <SlidersHorizontal className="size-3.5" /> Display
              </span>
            )}
          >
            {() => (
              <div className="flex flex-col gap-3 text-xs">
                {/* List / Board */}
                <div className="inline-flex rounded-md border border-border p-0.5">
                  {([
                    ["list", ListIcon, "List"],
                    ["board", LayoutGrid, "Board"],
                  ] as const).map(([mode, Icon, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setViewMode(mode)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2 py-1 font-medium transition-colors ${
                        viewMode === mode ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className="size-3.5" /> {label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{viewMode === "board" ? "Columns" : "Grouping"}</span>
                    <select className={miniSelect} value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                      <option value="status">Status</option>
                      <option value="assignee">Assignee</option>
                      <option value="priority">Priority</option>
                      <option value="project">Project</option>
                      <option value="none">None</option>
                    </select>
                  </div>
                  <DisplayOptions
                    ordering={ordering}
                    onOrdering={setOrdering}
                    completed={completed}
                    onCompleted={setCompleted}
                    display={display}
                    onToggleDisplay={(k) => setDisplay((d) => ({ ...d, [k]: !d[k] }))}
                  />
                  <ToggleRow label="Show sub-issues" on={showSubIssues} onClick={() => setShowSubIssues((v) => !v)} />
                </div>

                <div className="flex justify-end border-t border-border/60 pt-2.5">
                  <button
                    type="button"
                    onClick={reset}
                    className="flex cursor-pointer items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <RotateCcw className="size-3" /> Reset
                  </button>
                </div>
              </div>
            )}
          </Popover>
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
        {visible.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No issues. Sync to populate, or relax the filters.
          </div>
        ) : viewMode === "list" ? (
          // Vertical scroll only; each IssueRow scrolls horizontally on its own
          // (so a narrow split pane never shifts the whole list / clips the left).
          <div className="h-full overflow-y-auto pb-20">
            {groups.map((g) => (
              <div key={g.key}>
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                  className="sticky top-0 z-10 flex w-full cursor-pointer items-center gap-2 border-b border-border/60 bg-secondary/30 px-4 py-2 text-xs font-semibold text-foreground backdrop-blur"
                >
                  <ChevronDown className={`size-3.5 text-muted-foreground transition-transform ${collapsed[g.key] ? "-rotate-90" : ""}`} />
                  <GroupHeading group={g} />
                </button>
                {!collapsed[g.key] &&
                  g.issues.map((i) => (
                    <IssueRow
                      key={i.id}
                      issue={i}
                      display={display}
                      avatar={avatarOf(i.assigneeId)}
                      onOpen={open}
                      onContextMenu={(e) => openMenu(e, i.id)}
                      today={today}
                    />
                  ))}
              </div>
            ))}
          </div>
        ) : (
          // Darker board surface so the (bg-card) cards pop; columns separated by
          // a single hairline divider rather than a heavy gap.
          <div className="flex h-full overflow-x-auto bg-background">
            {groups.map((g) => (
              <div
                key={g.key}
                data-group-key={g.key}
                className={`flex w-80 shrink-0 flex-col border-r border-border/50 transition-colors last:border-r-0 ${
                  draggingId && dragOverKey === g.key ? "bg-accent/25" : ""
                }`}
              >
                <div className="flex items-center gap-2 px-2.5 py-2.5 text-xs font-semibold text-foreground">
                  <GroupHeading group={g} />
                </div>
                <div className="flex flex-col gap-2.5 overflow-y-auto px-2.5 pb-20">
                  {g.issues.map((i) => (
                    <BoardCard
                      key={i.id}
                      issue={i}
                      display={display}
                      avatar={avatarOf(i.assigneeId)}
                      today={today}
                      onPointerDown={(e) => onCardPointerDown(e, i)}
                      onPointerMove={onCardPointerMove}
                      onPointerUp={onCardPointerUp}
                      onPointerCancel={cancelCardGesture}
                      onContextMenu={(e) => openMenu(e, i.id)}
                      dragging={draggingId === i.id}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {ghost && (
        <div
          className="pointer-events-none fixed z-50 max-w-64 truncate rounded-lg border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground shadow-2xl"
          style={{ left: ghost.x + 14, top: ghost.y + 14 }}
        >
          {ghost.title}
        </div>
      )}
    </div>
  );
}
