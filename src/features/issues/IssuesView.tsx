import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, LayoutGrid, List as ListIcon, SlidersHorizontal } from "lucide-react";
import { useFilterOptions, useIssues, useMe, useUsers } from "@/lib/queries";
import { dhakaToday, isOverdue } from "@/lib/dates";
import type { Issue, IssueFilters } from "@/lib/commands";
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
type DisplayProps = {
  id: boolean;
  priority: boolean;
  assignee: boolean;
  dueDate: boolean;
  project: boolean;
};
const DEFAULT_DISPLAY: DisplayProps = {
  id: true,
  priority: true,
  assignee: true,
  dueDate: true,
  project: true,
};

function fmtDate(d: string): string {
  const [, m, day] = d.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${day}`;
}

type Group = { key: string; label: string; color?: string; issues: Issue[]; rank: number };

function groupIssues(issues: Issue[], by: GroupBy, usersById: Map<string, string>): Group[] {
  if (by === "none") return [{ key: "all", label: "All issues", issues, rank: 0 }];
  const map = new Map<string, Group>();
  for (const i of issues) {
    let key: string;
    let label: string;
    let color: string | undefined;
    let rank: number;
    if (by === "status") {
      key = i.stateName || i.stateType || "none";
      label = i.stateName || "No status";
      color = i.stateColor || undefined;
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
      g = { key, label, color, issues: [], rank };
      map.set(key, g);
    }
    g.issues.push(i);
  }
  return [...map.values()].sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
}

function StatusDot({ color }: { color: string }) {
  return <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

function PriorityBadge({ p }: { p: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <span className="size-1.5 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[p] ?? "#6b7280" }} />
      {PRIORITY_LABELS[p] ?? "No priority"}
    </span>
  );
}

function IssueRow({
  issue,
  display,
  avatarOf,
  onOpen,
  today,
}: {
  issue: Issue;
  display: DisplayProps;
  avatarOf: (id: string | null) => { name: string; src: string | null } | null;
  onOpen: (id: string) => void;
  today: string;
}) {
  const overdue = isOverdue(issue.dueDate, issue.stateType, today);
  const a = avatarOf(issue.assigneeId);
  return (
    <div
      onClick={() => onOpen(issue.id)}
      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent/60"
    >
      <StatusDot color={issue.stateColor || "#6b7280"} />
      {display.id && (
        <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{issue.identifier}</span>
      )}
      <span className="min-w-0 flex-1 truncate text-foreground">{issue.title}</span>
      {display.project && issue.projectName && (
        <span className="hidden shrink-0 truncate rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground md:inline">
          {issue.projectName}
        </span>
      )}
      {display.priority && <span className="hidden shrink-0 sm:inline"><PriorityBadge p={issue.priority} /></span>}
      {display.dueDate && issue.dueDate && (
        <span className={`shrink-0 text-xs ${overdue ? "text-red-400" : "text-muted-foreground"}`}>
          {fmtDate(issue.dueDate)}
        </span>
      )}
      {display.assignee &&
        (a ? <Avatar name={a.name} src={a.src} size={20} /> : <span className="size-5 shrink-0 rounded-full border border-dashed border-border" />)}
    </div>
  );
}

function Popover({ trigger, children }: { trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode }) {
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
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-md border border-border bg-popover p-3 shadow-xl">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function IssuesView() {
  const today = dhakaToday();
  const me = useMe();
  const { data: issues } = useIssues({});
  const { data: filterOpts } = useFilterOptions();
  const { data: users } = useUsers();
  const [, setParams] = useSearchParams();

  const [filters, setFilters] = useState<IssueFilters>({});
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [display, setDisplay] = useState<DisplayProps>(DEFAULT_DISPLAY);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const usersById = useMemo(() => new Map((users ?? []).map((u) => [u.id, u.name])), [users]);
  const avatarOf = (id: string | null) => {
    if (!id) return null;
    const u = (users ?? []).find((x) => x.id === id);
    return u ? { name: u.name, src: u.avatarUrl } : null;
  };

  const filtered = useMemo(
    () =>
      (issues ?? []).filter(
        (i) =>
          (!filters.teamId || i.teamId === filters.teamId) &&
          (!filters.assigneeId || i.assigneeId === filters.assigneeId) &&
          (!filters.projectId || i.projectId === filters.projectId),
      ),
    [issues, filters],
  );
  const groups = useMemo(() => groupIssues(filtered, groupBy, usersById), [filtered, groupBy, usersById]);

  const open = (id: string) => setParams({ issue: id });
  const sel = "cursor-pointer appearance-none rounded-md border border-border bg-secondary/40 py-1.5 pl-2.5 pr-7 text-xs font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="flex h-full flex-col gap-3 p-4 pb-24">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-sm font-semibold text-foreground">
          Issues <span className="text-muted-foreground">{filtered.length}</span>
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
                <SlidersHorizontal className="size-3.5" /> View
              </span>
            )}
          >
            {() => (
              <div className="flex flex-col gap-3 text-xs">
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
                <label className="flex items-center justify-between">
                  <span className="text-muted-foreground">Grouping</span>
                  <select
                    className="cursor-pointer rounded-md border border-border bg-secondary/40 px-2 py-1 text-foreground"
                    value={groupBy}
                    onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                  >
                    <option value="status">Status</option>
                    <option value="assignee">Assignee</option>
                    <option value="priority">Priority</option>
                    <option value="project">Project</option>
                    <option value="none">None</option>
                  </select>
                </label>
                <div>
                  <div className="mb-1.5 text-muted-foreground">Display properties</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(DEFAULT_DISPLAY) as (keyof DisplayProps)[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setDisplay((d) => ({ ...d, [k]: !d[k] }))}
                        className={`cursor-pointer rounded-full border px-2 py-0.5 capitalize transition-colors ${
                          display[k]
                            ? "border-transparent bg-accent text-foreground"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {k === "id" ? "ID" : k === "dueDate" ? "Due date" : k}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </Popover>
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-card">
        {filtered.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No issues. Sync to populate, or relax the filters.
          </div>
        )}

        {viewMode === "list" &&
          groups.map((g) => (
            <div key={g.key} className="border-b border-border/60 last:border-b-0">
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground"
              >
                <ChevronDown className={`size-3.5 text-muted-foreground transition-transform ${collapsed[g.key] ? "-rotate-90" : ""}`} />
                {g.color && <span className="size-2.5 rounded-full" style={{ backgroundColor: g.color }} />}
                <span>{g.label}</span>
                <span className="text-muted-foreground">{g.issues.length}</span>
              </button>
              {!collapsed[g.key] && (
                <div className="pb-1">
                  {g.issues.map((i) => (
                    <IssueRow key={i.id} issue={i} display={display} avatarOf={avatarOf} onOpen={open} today={today} />
                  ))}
                </div>
              )}
            </div>
          ))}

        {viewMode === "board" && (
          <div className="flex h-full gap-3 overflow-x-auto p-3">
            {groups.map((g) => (
              <div key={g.key} className="flex w-72 shrink-0 flex-col rounded-md border border-border bg-background/40">
                <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground">
                  {g.color && <span className="size-2.5 rounded-full" style={{ backgroundColor: g.color }} />}
                  <span>{g.label}</span>
                  <span className="text-muted-foreground">{g.issues.length}</span>
                </div>
                <div className="flex flex-col gap-2 overflow-y-auto p-2">
                  {g.issues.map((i) => {
                    const a = avatarOf(i.assigneeId);
                    return (
                      <div
                        key={i.id}
                        onClick={() => open(i.id)}
                        className="cursor-pointer rounded-md border border-border bg-card p-2.5 transition-colors hover:border-foreground/20"
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span className="font-mono text-[11px] text-muted-foreground">{i.identifier}</span>
                          {a ? <Avatar name={a.name} src={a.src} size={18} /> : null}
                        </div>
                        <div className="line-clamp-2 text-xs text-foreground">{i.title}</div>
                        {display.priority && (
                          <div className="mt-1.5">
                            <PriorityBadge p={i.priority} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
