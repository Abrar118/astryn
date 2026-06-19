import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowDownUp,
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
import { useFilterOptions, useIssues, useMe, useUpdateIssue, useUsers } from "@/lib/queries";
import { dhakaToday, isOverdue } from "@/lib/dates";
import type { IssueListItem, IssueFilters, Label, UpdateIssuePatch } from "@/lib/commands";
import { Avatar } from "@/components/Avatar";
import { AssigneeSelect } from "@/components/AssigneeSelect";

const PRIORITY_LABELS = ["No priority", "Urgent", "High", "Medium", "Low"];
const PRIORITY_COLORS = ["#6b7280", "#ef4444", "#f97316", "#eab308", "#3b82f6"];
const PRIORITY_ORDER = [1, 2, 3, 4, 0]; // Urgent → High → Medium → Low → None
const STATE_RANK: Record<string, number> = {
  backlog: 0,
  unstarted: 1,
  started: 2,
  completed: 3,
  canceled: 4,
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type GroupBy = "status" | "assignee" | "priority" | "project" | "none";
type ViewMode = "list" | "board";
type Ordering = "status" | "priority" | "dueDate" | "title" | "created" | "updated";
type Completed = "all" | "active";
type DisplayKey =
  | "id"
  | "status"
  | "priority"
  | "assignee"
  | "dueDate"
  | "project"
  | "labels"
  | "estimate"
  | "cycle"
  | "milestone"
  | "links"
  | "pullRequests"
  | "created"
  | "updated";
type DisplayProps = Record<DisplayKey, boolean>;

const DEFAULT_DISPLAY: DisplayProps = {
  id: true,
  status: false,
  priority: true,
  assignee: true,
  dueDate: true,
  project: true,
  labels: true,
  estimate: false,
  cycle: false,
  milestone: false,
  links: false,
  pullRequests: false,
  created: false,
  updated: false,
};
const DISPLAY_LABELS: Record<DisplayKey, string> = {
  id: "ID",
  status: "Status",
  priority: "Priority",
  assignee: "Assignee",
  dueDate: "Due date",
  project: "Project",
  labels: "Labels",
  estimate: "Estimate",
  cycle: "Cycle",
  milestone: "Milestone",
  links: "Links",
  pullRequests: "Pull requests",
  created: "Created",
  updated: "Updated",
};

// ── Persisted view config (survives reload + app launch) ─────────────────────
type ViewConfig = {
  filters: IssueFilters;
  groupBy: GroupBy;
  viewMode: ViewMode;
  ordering: Ordering;
  completed: Completed;
  showSubIssues: boolean;
  display: DisplayProps;
};
const VIEW_KEY = "astryn.issues-view";
const DEFAULT_CONFIG: ViewConfig = {
  filters: {},
  groupBy: "status",
  viewMode: "list",
  ordering: "status",
  completed: "all",
  showSubIssues: true,
  display: DEFAULT_DISPLAY,
};

function loadConfig(): ViewConfig {
  try {
    const p = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") as Partial<ViewConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...p,
      filters: p.filters ?? {},
      // Merge so display keys added in later versions get their default.
      display: { ...DEFAULT_DISPLAY, ...(p.display ?? {}) },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function fmtDate(d: string): string {
  const [, m, day] = d.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${day}`;
}

function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/** Relative-friendly due label in Dhaka calendar terms. */
function dueLabel(d: string, today: string): string {
  const diff = dayDiff(today, d);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  return fmtDate(d);
}

// ── Iconography (Linear-style) ───────────────────────────────────────────────

/** Ring/pie status glyph approximating Linear's state icons. */
function StatusIcon({ type, color }: { type: string; color: string }) {
  const c = color || "#6b7280";
  if (type === "completed") {
    return (
      <svg viewBox="0 0 14 14" className="size-3.5 shrink-0" aria-hidden>
        <circle cx="7" cy="7" r="7" fill={c} />
        <path d="M3.9 7.2l2 2 4.2-4.4" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "canceled") {
    return (
      <svg viewBox="0 0 14 14" className="size-3.5 shrink-0" aria-hidden>
        <circle cx="7" cy="7" r="7" fill="#6b7280" />
        <path d="M4.6 4.6l4.8 4.8M9.4 4.6l-4.8 4.8" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  // backlog (dashed) / unstarted (empty) / started (half pie)
  return (
    <svg viewBox="0 0 14 14" className="size-3.5 shrink-0" aria-hidden>
      <circle
        cx="7"
        cy="7"
        r="5.4"
        fill="none"
        stroke={c}
        strokeWidth="1.6"
        strokeDasharray={type === "backlog" ? "2 2.2" : undefined}
      />
      {type === "started" && (
        <circle
          cx="7"
          cy="7"
          r="2.7"
          fill="none"
          stroke={c}
          strokeWidth="5.4"
          strokeDasharray="8.5 100"
          transform="rotate(-90 7 7)"
        />
      )}
    </svg>
  );
}

/** Three-bar priority glyph (Linear-style). Urgent renders in red. */
function PriorityIcon({ p }: { p: number }) {
  const filled = p === 0 ? 0 : p === 4 ? 1 : p === 3 ? 2 : 3; // low=1, medium=2, high/urgent=3
  const urgent = p === 1;
  const label = `Priority: ${PRIORITY_LABELS[p] ?? "No priority"}`;
  return (
    <span className="inline-flex items-end gap-[2px]" title={label} aria-label={label}>
      {[4, 7, 10].map((h, i) => (
        <span
          key={i}
          style={{ height: h }}
          className={`w-[3px] rounded-[1px] ${i < filled ? (urgent ? "bg-red-500" : "bg-muted-foreground") : "bg-border"}`}
        />
      ))}
    </span>
  );
}

function Pill({ children, className = "", title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground ${className}`}
    >
      {children}
    </span>
  );
}

/** Up to `max` label chips (colored dot + name), then a "+N" overflow pill. */
function LabelPills({ labels, max = 2 }: { labels: Label[]; max?: number }) {
  if (labels.length === 0) return null;
  const shown = labels.slice(0, max);
  const extra = labels.slice(max);
  return (
    <span className="flex shrink-0 items-center gap-1">
      {shown.map((l) => (
        <Pill key={l.id} title={`Label: ${l.name ?? "label"}`}>
          <span className="size-1.5 rounded-full" style={{ backgroundColor: l.color ?? "#6b7280" }} />
          <span className="max-w-24 truncate">{l.name ?? "label"}</span>
        </Pill>
      ))}
      {extra.length > 0 && (
        <Pill title={`Labels: ${extra.map((l) => l.name ?? "label").join(", ")}`}>+{extra.length}</Pill>
      )}
    </span>
  );
}

function cycleText(i: IssueListItem): string | null {
  if (i.cycleName) return i.cycleName;
  if (i.cycleNumber != null) return `Cycle ${i.cycleNumber}`;
  return null;
}

// ── Grouping & ordering ──────────────────────────────────────────────────────

type Group = { key: string; label: string; color?: string; type?: string; issues: IssueListItem[]; rank: number };

function groupIssues(issues: IssueListItem[], by: GroupBy, usersById: Map<string, string>): Group[] {
  if (by === "none") return [{ key: "all", label: "All issues", issues, rank: 0 }];
  const map = new Map<string, Group>();
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

function compareIssues(a: IssueListItem, b: IssueListItem, by: Ordering): number {
  switch (by) {
    case "priority":
      return PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
    case "dueDate":
      return (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99");
    case "title":
      return a.title.localeCompare(b.title);
    case "created":
      return b.createdAt.localeCompare(a.createdAt); // newest first
    case "updated":
      return b.updatedAt.localeCompare(a.updatedAt); // newest first
    case "status":
    default:
      return (STATE_RANK[a.stateType] ?? 9) - (STATE_RANK[b.stateType] ?? 9);
  }
}

// ── Rows & cards ─────────────────────────────────────────────────────────────

type AvatarInfo = { name: string; src: string | null } | null;

function MetaCluster({
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
    <div className="flex shrink-0 items-center gap-2">
      {display.status && issue.stateName && (
        <Pill title={`Status: ${issue.stateName}`}>
          <StatusIcon type={issue.stateType} color={issue.stateColor} />
          <span className="hidden lg:inline">{issue.stateName}</span>
        </Pill>
      )}
      {display.labels && <span className="hidden lg:flex"><LabelPills labels={issue.labels} /></span>}
      {display.project && issue.projectName && (
        <Pill className="hidden md:inline-flex" title={`Project: ${issue.projectName}`}>
          <Box className="size-3" />
          <span className="max-w-32 truncate">{issue.projectName}</span>
        </Pill>
      )}
      {display.milestone && issue.milestoneName && (
        <Pill className="hidden lg:inline-flex" title={`Milestone: ${issue.milestoneName}`}>
          <Milestone className="size-3" />
          <span className="max-w-28 truncate">{issue.milestoneName}</span>
        </Pill>
      )}
      {display.cycle && cycle && (
        <Pill className="hidden lg:inline-flex" title={`Cycle: ${cycle}`}>
          <IterationCcw className="size-3" />
          {cycle}
        </Pill>
      )}
      {display.estimate && issue.estimate != null && (
        <Pill title={`Estimate: ${issue.estimate} points`}>
          <Gauge className="size-3" />
          {issue.estimate}
        </Pill>
      )}
      {display.pullRequests && issue.prCount > 0 && (
        <Pill title={`${issue.prCount} pull request${issue.prCount === 1 ? "" : "s"}`}>
          <GitPullRequest className="size-3" />
          {issue.prCount}
        </Pill>
      )}
      {display.links && issue.linkCount > 0 && (
        <Pill title={`${issue.linkCount} link${issue.linkCount === 1 ? "" : "s"}`}>
          <Link2 className="size-3" />
          {issue.linkCount}
        </Pill>
      )}
      {display.priority && (
        <span className="hidden sm:flex">
          <PriorityIcon p={issue.priority} />
        </span>
      )}
      {display.dueDate && issue.dueDate && (
        <Pill
          className={overdue ? "border-red-500/40 text-red-400" : ""}
          title={`Due date: ${fmtDate(issue.dueDate)}${overdue ? " (overdue)" : ""}`}
        >
          <CalendarDays className="size-3" />
          {dueLabel(issue.dueDate, today)}
        </Pill>
      )}
      {display.created && (
        <span
          className="hidden w-14 shrink-0 text-right text-[11px] text-muted-foreground xl:inline"
          title={`Created ${fmtDate(issue.createdAt.slice(0, 10))}`}
        >
          {fmtDate(issue.createdAt.slice(0, 10))}
        </span>
      )}
      {display.updated && (
        <span
          className="hidden w-14 shrink-0 text-right text-[11px] text-muted-foreground xl:inline"
          title={`Updated ${fmtDate(issue.updatedAt.slice(0, 10))}`}
        >
          {fmtDate(issue.updatedAt.slice(0, 10))}
        </span>
      )}
      {display.assignee &&
        (avatar ? (
          <span title={`Assignee: ${avatar.name}`} className="flex">
            <Avatar name={avatar.name} src={avatar.src} size={20} />
          </span>
        ) : (
          <span title="Unassigned" className="size-5 shrink-0 rounded-full border border-dashed border-border" />
        ))}
    </div>
  );
}

function IssueRow({
  issue,
  display,
  avatar,
  onOpen,
  today,
}: {
  issue: IssueListItem;
  display: DisplayProps;
  avatar: AvatarInfo;
  onOpen: (id: string) => void;
  today: string;
}) {
  return (
    <div
      onClick={() => onOpen(issue.id)}
      className="group flex cursor-pointer items-center gap-3 border-b border-border/40 px-4 py-2 text-sm transition-colors last:border-b-0 hover:bg-accent/50"
    >
      <span title={`Status: ${issue.stateName || issue.stateType || "No status"}`} className="flex">
        <StatusIcon type={issue.stateType} color={issue.stateColor} />
      </span>
      {display.id && (
        <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground" title={issue.identifier}>
          {issue.identifier}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-foreground">{issue.title}</span>
      <MetaCluster issue={issue} display={display} avatar={avatar} today={today} />
    </div>
  );
}

function BoardCard({
  issue,
  display,
  avatar,
  onOpen,
  today,
  draggable,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  issue: IssueListItem;
  display: DisplayProps;
  avatar: AvatarInfo;
  onOpen: (id: string) => void;
  today: string;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: () => void;
  dragging?: boolean;
}) {
  const overdue = isOverdue(issue.dueDate, issue.stateType, today);
  const cycle = cycleText(issue);
  return (
    <div
      onClick={() => onOpen(issue.id)}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`rounded-lg border border-border bg-card p-3 transition-colors hover:border-foreground/25 ${
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${dragging ? "opacity-40" : ""}`}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[11px] text-muted-foreground">{display.id ? issue.identifier : ""}</span>
        {display.assignee &&
          (avatar ? (
            <Avatar name={avatar.name} src={avatar.src} size={18} />
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
            {issue.prCount}
          </Pill>
        )}
        {display.links && issue.linkCount > 0 && (
          <Pill>
            <Link2 className="size-3" />
            {issue.linkCount}
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
        <div className="mt-2 text-[11px] text-muted-foreground">Created {fmtDate(issue.createdAt.slice(0, 10))}</div>
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

const miniSelect =
  "cursor-pointer rounded-md border border-border bg-secondary/40 px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
  const update = useUpdateIssue();
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
    return u ? { name: u.name, src: u.avatarUrl } : null;
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
    const gs = groupIssues(visible, groupBy, usersById);
    for (const g of gs) g.issues.sort((a, b) => compareIssues(a, b, ordering));
    return gs;
  }, [visible, groupBy, ordering, usersById]);

  const open = (id: string) => setParams({ issue: id });

  // ── Board drag & drop ──────────────────────────────────────────────────────
  // Dropping a card into another column applies the patch implied by the current
  // grouping. Status is team-scoped in Linear, so we resolve the target stateId
  // from a sibling issue of the SAME team already in that status.
  const statesByTeamName = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of issues ?? []) {
      if (i.teamId && i.stateName && i.stateId) m.set(`${i.teamId}::${i.stateName}`, i.stateId);
    }
    return m;
  }, [issues]);
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

  const handleDrop = (g: Group) => {
    setDragOverKey(null);
    const id = draggingId;
    setDraggingId(null);
    if (!id) return;
    const issue = (issues ?? []).find((i) => i.id === id);
    if (!issue) return;
    const patch = patchForDrop(issue, g);
    if (patch) update.mutate({ id, patch });
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
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <ArrowDownUp className="size-3" /> Ordering
                    </span>
                    <select className={miniSelect} value={ordering} onChange={(e) => setOrdering(e.target.value as Ordering)}>
                      <option value="status">Status</option>
                      <option value="priority">Priority</option>
                      <option value="dueDate">Due date</option>
                      <option value="title">Title</option>
                      <option value="created">Created</option>
                      <option value="updated">Updated</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Completed issues</span>
                    <select className={miniSelect} value={completed} onChange={(e) => setCompleted(e.target.value as Completed)}>
                      <option value="all">All</option>
                      <option value="active">Active only</option>
                    </select>
                  </div>
                  <ToggleRow label="Show sub-issues" on={showSubIssues} onClick={() => setShowSubIssues((v) => !v)} />
                </div>

                <div className="border-t border-border/60 pt-3">
                  <div className="mb-1.5 text-muted-foreground">Display properties</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(DEFAULT_DISPLAY) as DisplayKey[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setDisplay((d) => ({ ...d, [k]: !d[k] }))}
                        className={`cursor-pointer rounded-full border px-2 py-0.5 transition-colors ${
                          display[k]
                            ? "border-transparent bg-accent text-foreground"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {DISPLAY_LABELS[k]}
                      </button>
                    ))}
                  </div>
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
                    <IssueRow key={i.id} issue={i} display={display} avatar={avatarOf(i.assigneeId)} onOpen={open} today={today} />
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
                onDragOver={dndEnabled ? (e) => { e.preventDefault(); setDragOverKey(g.key); } : undefined}
                onDragLeave={() => dragOverKey === g.key && setDragOverKey(null)}
                onDrop={dndEnabled ? () => handleDrop(g) : undefined}
                className={`flex w-80 shrink-0 flex-col border-r border-border/50 transition-colors last:border-r-0 ${
                  dragOverKey === g.key ? "bg-accent/25" : ""
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
                      onOpen={open}
                      today={today}
                      draggable={dndEnabled}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", i.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDraggingId(i.id);
                      }}
                      onDragEnd={() => setDraggingId(null)}
                      dragging={draggingId === i.id}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
