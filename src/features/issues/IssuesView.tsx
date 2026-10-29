import { useConnectionStatus } from "@/lib/queries";
import { useWorkspace } from "@/lib/tabs";
import { requestSettingsSection } from "@/features/settings/settingsSection";
import { SetupState } from "@/components/SetupState";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
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
import { useFilterOptions, useIssues, useMe, useUsers, useWorkflowStates } from "@/lib/queries";
import { useUpdateTask } from "@/lib/taskQueries";
import { dhakaDateFromTimestamp, dhakaToday, isOverdue } from "@/lib/dates";
import type { IssueListItem, IssueFilters, UpdateIssuePatch, WorkflowState } from "@/lib/commands";
import { Avatar } from "@/components/Avatar";
import { AssigneeSelect } from "@/components/AssigneeSelect";
import { useIssueMenu } from "./IssueContextMenu";
import {
  DEFAULT_DISPLAY,
  VIEW_KEY,
  parseViewConfig,
  pruneFilters,
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
import { IndicatorLamp } from "@/components/IndicatorLamp";
import { StatusIcon } from "../drawer/issueGlyphs";
import { DisplayOptions, LampToggle, OptionRow, miniSelect } from "./DisplayOptions";

/** Toolbar filter controls: a quiet outline control on the faceplate. */
const TOOL_CONTROL =
  "dash-control flex h-7 items-center gap-1.5 rounded-md border border-input bg-transparent px-2 text-[12px] text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 dark:bg-input/30";

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

type AvatarInfo = { name: string; avatarUrl?: string | null } | null;

/** Pure visual for a board card (used both in columns and the drag overlay). */
function BoardCardView({
  issue,
  display,
  avatar,
  today,
}: {
  issue: IssueListItem;
  display: DisplayProps;
  avatar: AvatarInfo;
  today: string;
}) {
  const overdue = isOverdue(issue.dueDate, issue.stateType, today);
  const cycle = cycleText(issue);
  return (
    <>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">{display.id ? issue.identifier : ""}</span>
        {display.assignee &&
          (avatar ? (
            <Avatar name={avatar.name} src={avatar.avatarUrl} size={18} />
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
          <Pill className={overdue ? "text-destructive" : ""}>
            {overdue ? <IndicatorLamp tone="danger" className="mx-0.5 size-1.5" /> : <CalendarDays className="size-3" />}
            {dueLabel(issue.dueDate, today)}
          </Pill>
        )}
      </div>
      {display.created && (
        <div className="mt-2 text-[12px] tabular-nums text-muted-foreground">Created {fmtDate(dhakaDateFromTimestamp(issue.createdAt))}</div>
      )}
    </>
  );
}

const CARD_CLASS = "rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent";

/** A draggable board card (@dnd-kit). Disabled groupings render it click-only. */
function BoardCard({
  issue,
  display,
  avatar,
  today,
  disabled,
  onOpen,
  onContextMenu,
}: {
  issue: IssueListItem;
  display: DisplayProps;
  avatar: AvatarInfo;
  today: string;
  disabled: boolean;
  onOpen: (id: string) => void;
  onContextMenu: (e: ReactMouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: issue.id, disabled });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(issue.id)}
      onContextMenu={onContextMenu}
      style={{ touchAction: "none" }}
      className={`select-none ${disabled ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"} ${CARD_CLASS} ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <BoardCardView issue={issue} display={display} avatar={avatar} today={today} />
    </div>
  );
}

/** A droppable board column. */
function BoardColumn({ group, children }: { group: Group; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: group.key });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-80 shrink-0 flex-col border-r border-border transition-colors last:border-r-0 ${
        isOver ? "bg-accent/40" : ""
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-3 text-[13px] font-semibold text-foreground">
        <GroupHeading group={group} />
      </div>
      <div className="drawer-scrollbar flex flex-col gap-2 overflow-y-auto px-2.5 pb-28">{children}</div>
    </div>
  );
}

function GroupHeading({ group }: { group: Group }) {
  return (
    <>
      {group.type ? (
        <StatusIcon type={group.type} color={group.color || "var(--muted-foreground)"} />
      ) : group.color ? (
        <span className="size-2 rounded-full" style={{ backgroundColor: group.color }} />
      ) : null}
      <span className="truncate">{group.label}</span>
      <span className="font-normal tabular-nums text-muted-foreground">{group.issues.length}</span>
    </>
  );
}

// ── Options popover ──────────────────────────────────────────────────────────

function Popover({
  trigger,
  buttonClassName,
  children,
}: {
  trigger: (open: boolean) => ReactNode;
  buttonClassName: string;
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
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={buttonClassName}>
        {trigger(open)}
      </button>
      {open && (
        <div className="issues-overlay absolute right-0 z-30 mt-1 w-72 rounded-lg border border-border bg-popover p-3">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

// ── View ─────────────────────────────────────────────────────────────────────

export function IssuesView() {
  const linearStatus = useConnectionStatus();
  const { setActiveView } = useWorkspace();
  const today = dhakaToday();
  const me = useMe();
  const { data: issues } = useIssues({});
  const { data: filterOpts } = useFilterOptions();
  const { data: users } = useUsers();
  const { data: workflowStates } = useWorkflowStates();
  const update = useUpdateTask();
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
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  // distance:5 so a plain click opens the drawer instead of starting a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // Filters persist by raw Linear id, so a workspace switch can leave one
  // pointing at an entity that no longer exists — which filters the list down to
  // nothing with no visible cause. Drop those once the option lists have loaded.
  useEffect(() => {
    setFilters((f) => pruneFilters(f, { teams: filterOpts?.teams, projects: filterOpts?.projects, users }));
  }, [filterOpts, users]);

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
    return u ? { name: u.name, avatarUrl: u.avatarUrl } : null;
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

  // Card drag via @dnd-kit: dropping a card on another column applies the patch
  // implied by the current grouping. Cards are non-draggable when the grouping
  // doesn't map to a mutation (project / none); a click always opens the drawer.
  const activeCard = activeCardId ? (issues ?? []).find((i) => i.id === activeCardId) ?? null : null;

  const onBoardDragStart = (e: DragStartEvent) => setActiveCardId(e.active.id as string);

  const onBoardDragEnd = (e: DragEndEvent) => {
    setActiveCardId(null);
    const { active, over } = e;
    if (!over) return;
    const target = groups.find((g) => g.key === over.id);
    if (!target) return;
    const issue = (issues ?? []).find((i) => i.id === active.id);
    if (!issue) return;
    const patch = patchForDrop(issue, target);
    if (patch) update.mutate({ id: active.id as string, patch });
  };

  const reset = () => {
    setGroupBy("status");
    setViewMode("list");
    setOrdering("status");
    setCompleted("all");
    setShowSubIssues(true);
    setDisplay(DEFAULT_DISPLAY);
  };

  const sel = `${TOOL_CONTROL} appearance-none pr-7`;

  if (linearStatus.data?.state === "not_configured") {
    return (
      <SetupState
        title="Issues"
        message="Connect Linear to list your workspace's issues here."
        action="Connect Linear"
        onAction={() => {
          requestSettingsSection("linear");
          setActiveView("settings");
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header: the page heading with its count as a reading, then the filters */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-border px-4 pt-4 pb-3">
        <h1 className="mr-3 flex items-baseline gap-2 text-[20px] font-semibold tracking-tight text-foreground">
          Issues
          <span className="dash-numeral text-[20px] text-muted-foreground" aria-label={`${visible.length} shown`}>
            {visible.length}
          </span>
        </h1>
        <AssigneeSelect
          value={filters.assigneeId ?? null}
          onChange={(id) => setFilters((f) => ({ ...f, assigneeId: id ?? undefined }))}
          users={users ?? []}
          meId={me.data?.viewerId}
          emptyLabel="All assignees"
          triggerClassName={TOOL_CONTROL}
        />
        <div className="relative">
          <select
            aria-label="Team"
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
            aria-label="Project"
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
            buttonClassName={TOOL_CONTROL}
            trigger={() => (
              <>
                <SlidersHorizontal className="size-3.5 text-muted-foreground" /> Display
              </>
            )}
          >
            {() => (
              <div className="flex flex-col gap-3 text-[12px]">
                {/* List / Board: a two-position selector, the active side on the faceplate */}
                <div role="group" aria-label="Layout" className="grid grid-cols-2 gap-0.5 rounded-md bg-sidebar p-0.5">
                  {([
                    ["list", ListIcon, "List"],
                    ["board", LayoutGrid, "Board"],
                  ] as const).map(([mode, Icon, label]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={viewMode === mode}
                      onClick={() => setViewMode(mode)}
                      className={`dash-control flex items-center justify-center gap-1.5 rounded-[6px] px-2 py-1 transition-colors ${
                        viewMode === mode ? "bg-popover text-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className="size-3.5" /> {label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  <OptionRow label={viewMode === "board" ? "columns" : "grouping"}>
                    <select
                      aria-label={viewMode === "board" ? "Columns" : "Grouping"}
                      className={miniSelect}
                      value={groupBy}
                      onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                    >
                      <option value="status">Status</option>
                      <option value="assignee">Assignee</option>
                      <option value="priority">Priority</option>
                      <option value="project">Project</option>
                      <option value="none">None</option>
                    </select>
                  </OptionRow>
                  <DisplayOptions
                    ordering={ordering}
                    onOrdering={setOrdering}
                    completed={completed}
                    onCompleted={setCompleted}
                    display={display}
                    onToggleDisplay={(k) => setDisplay((d) => ({ ...d, [k]: !d[k] }))}
                  />
                  <LampToggle className="-mx-1.5" label="show sub-issues" on={showSubIssues} onClick={() => setShowSubIssues((v) => !v)} />
                </div>

                <div className="flex justify-end border-t border-border pt-2.5">
                  <button
                    type="button"
                    onClick={reset}
                    className="dash-control flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <RotateCcw className="size-3" /> Reset
                  </button>
                </div>
              </div>
            )}
          </Popover>
        </div>
      </div>

      {/* Content: rows straight on the faceplate, divided by hairlines */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {visible.length === 0 ? (
          <div className="flex items-start gap-3 px-4 py-6">
            <IndicatorLamp tone="off" className="mt-1.5" />
            <div>
              <p className="text-[13px] font-medium text-foreground">No issues</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">Sync to populate, or relax the filters.</p>
            </div>
          </div>
        ) : viewMode === "list" ? (
          // Vertical scroll only; each IssueRow scrolls horizontally on its own
          // (so a narrow split pane never shifts the whole list / clips the left).
          <div className="drawer-scrollbar h-full overflow-y-auto pb-28">
            {groups.map((g) => (
              <div key={g.key}>
                <button
                  type="button"
                  aria-expanded={!collapsed[g.key]}
                  onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                  className="issues-group dash-control sticky top-0 z-10 flex w-full items-center gap-2 border-b border-border bg-card px-4 py-2 text-[13px] font-semibold text-foreground"
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
          // Cards sit one lightness step above the faceplate; columns are
          // separated by a single hairline rather than a gap.
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onBoardDragStart}
            onDragEnd={onBoardDragEnd}
            onDragCancel={() => setActiveCardId(null)}
          >
            <div className="drawer-scrollbar flex h-full overflow-x-auto bg-background">
              {groups.map((g) => (
                <BoardColumn key={g.key} group={g}>
                  {g.issues.map((i) => (
                    <BoardCard
                      key={i.id}
                      issue={i}
                      display={display}
                      avatar={avatarOf(i.assigneeId)}
                      today={today}
                      disabled={!dndEnabled}
                      onOpen={open}
                      onContextMenu={(e) => openMenu(e, i.id)}
                    />
                  ))}
                </BoardColumn>
              ))}
            </div>
            <DragOverlay dropAnimation={null}>
              {activeCard ? (
                <div className={`${CARD_CLASS} issues-overlay w-72 cursor-grabbing`}>
                  <BoardCardView issue={activeCard} display={display} avatar={avatarOf(activeCard.assigneeId)} today={today} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </div>
  );
}
