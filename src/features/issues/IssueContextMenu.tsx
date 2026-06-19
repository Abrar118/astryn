import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { gooeyToast } from "goey-toast";
import {
  Box,
  Calendar,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Gauge,
  IterationCcw,
  ListChecks,
  PanelRight,
  SignalHigh,
  Tag,
  Trash2,
  User as UserIcon,
  Users,
} from "lucide-react";
import {
  useCycles,
  useDeleteIssue,
  useFilterOptions,
  useIssues,
  useLabels,
  useUpdateIssue,
  useUsers,
} from "@/lib/queries";
import { dhakaToday } from "@/lib/dates";
import type { IssueListItem, UpdateIssuePatch, User } from "@/lib/commands";
import { Avatar } from "@/components/Avatar";

const PRIORITIES = [
  { value: 1, label: "Urgent", color: "#ef4444" },
  { value: 2, label: "High", color: "#f97316" },
  { value: 3, label: "Medium", color: "#eab308" },
  { value: 4, label: "Low", color: "#3b82f6" },
  { value: 0, label: "No priority", color: "#6b7280" },
];
const STATE_RANK: Record<string, number> = {
  backlog: 0,
  unstarted: 1,
  started: 2,
  completed: 3,
  canceled: 4,
};
const ESTIMATES = [0, 1, 2, 3, 5, 8];

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // WKWebView clipboard can be flaky; fall back to execCommand.
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      ta.remove();
    }
  }
  gooeyToast.success(`${label} copied`);
}

type Ctx = { openMenu: (e: ReactMouseEvent, id: string) => void };
const MenuCtx = createContext<Ctx | null>(null);

export function useIssueMenu(): Ctx {
  const ctx = useContext(MenuCtx);
  if (!ctx) throw new Error("useIssueMenu must be used within IssueMenuProvider");
  return ctx;
}

type MenuState = { id: string; x: number; y: number };

export function IssueMenuProvider({ children }: { children: ReactNode }) {
  const { data: issues } = useIssues({});
  const { data: users } = useUsers();
  const [menu, setMenu] = useState<MenuState | null>(null);

  const openMenu = (e: ReactMouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ id, x: e.clientX, y: e.clientY });
  };

  const issue = menu ? (issues ?? []).find((i) => i.id === menu.id) ?? null : null;

  return (
    <MenuCtx.Provider value={{ openMenu }}>
      {children}
      {menu && issue && (
        <Menu
          issue={issue}
          users={users ?? []}
          allIssues={issues ?? []}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </MenuCtx.Provider>
  );
}

function Row({
  icon,
  label,
  onClick,
  onMouseEnter,
  hasSub,
  active,
}: {
  icon: ReactNode;
  label: ReactNode;
  onClick?: () => void;
  onMouseEnter?: () => void;
  hasSub?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-accent"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {active && <Check className="size-3.5 shrink-0 text-primary" />}
      {hasSub && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
    </button>
  );
}

function SubMenu({ flip, children }: { flip: boolean; children: ReactNode }) {
  return (
    <div
      className={`absolute -top-1 z-10 max-h-80 w-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-2xl ${
        flip ? "right-full mr-1" : "left-full ml-1"
      }`}
    >
      {children}
    </div>
  );
}

function Menu({
  issue,
  users,
  allIssues,
  x,
  y,
  onClose,
}: {
  issue: IssueListItem;
  users: User[];
  allIssues: IssueListItem[];
  x: number;
  y: number;
  onClose: () => void;
}) {
  const update = useUpdateIssue();
  const del = useDeleteIssue();
  const { data: labels } = useLabels();
  const { data: cycles } = useCycles();
  const { data: filterOpts } = useFilterOptions();
  const [params, setParams] = useSearchParams();
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<string | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const patch = (p: UpdateIssuePatch) => {
    update.mutate({ id: issue.id, patch: p });
    onClose();
  };

  // Labels are multi-select: toggle without closing so several can be set.
  const toggleLabel = (labelId: string) => {
    const has = issue.labels.some((l) => l.id === labelId);
    const ids = has
      ? issue.labels.filter((l) => l.id !== labelId).map((l) => l.id)
      : [...issue.labels.map((l) => l.id), labelId];
    update.mutate({ id: issue.id, patch: { labelIds: ids } });
  };

  const removeIssue = () => {
    del.mutate(issue.id);
    if (params.get("issue") === issue.id) setParams({});
    onClose();
  };

  const teamCycles = useMemo(
    () =>
      (cycles ?? [])
        .filter((c) => c.teamId === issue.teamId)
        .sort((a, b) => (b.number ?? 0) - (a.number ?? 0)),
    [cycles, issue.teamId],
  );

  // Available states for this issue's team, derived from the cached issues.
  const teamStates = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; type: string; color: string }>();
    for (const i of allIssues) {
      if (i.teamId === issue.teamId && i.stateId && i.stateName) {
        seen.set(i.stateId, { id: i.stateId, name: i.stateName, type: i.stateType, color: i.stateColor });
      }
    }
    return [...seen.values()].sort((a, b) => (STATE_RANK[a.type] ?? 9) - (STATE_RANK[b.type] ?? 9));
  }, [allIssues, issue.teamId, issue.stateId, issue.stateName, issue.stateType, issue.stateColor]);

  const today = dhakaToday();
  const left = Math.min(x, window.innerWidth - 236);
  const top = Math.min(y, window.innerHeight - 320);
  const flip = left > window.innerWidth - 236 - 232;

  return (
    <div
      ref={ref}
      className="fixed z-50 w-56 rounded-lg border border-border bg-popover p-1 text-foreground shadow-2xl"
      style={{ left, top }}
    >
      {/* Team (move to another team) */}
      <div className="relative" onMouseEnter={() => setSub("team")}>
        <Row icon={<Users className="size-4" />} label="Team" hasSub />
        {sub === "team" && (
          <SubMenu flip={flip}>
            {(filterOpts?.teams ?? []).length === 0 && (
              <div className="px-2.5 py-1.5 text-[12px] text-muted-foreground">No teams</div>
            )}
            {(filterOpts?.teams ?? []).map((t) => (
              <Row
                key={t.id}
                icon={<Users className="size-4" />}
                label={t.key}
                active={t.id === issue.teamId}
                onClick={() => patch({ teamId: t.id })}
              />
            ))}
          </SubMenu>
        )}
      </div>

      {/* Status */}
      <div className="relative" onMouseEnter={() => setSub("status")}>
        <Row icon={<ListChecks className="size-4" />} label="Status" hasSub />
        {sub === "status" && (
          <SubMenu flip={flip}>
            {teamStates.length === 0 && <div className="px-2.5 py-1.5 text-[12px] text-muted-foreground">No states cached</div>}
            {teamStates.map((s) => (
              <Row
                key={s.id}
                icon={<span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />}
                label={s.name}
                active={s.id === issue.stateId}
                onClick={() => patch({ stateId: s.id })}
              />
            ))}
          </SubMenu>
        )}
      </div>

      {/* Priority */}
      <div className="relative" onMouseEnter={() => setSub("priority")}>
        <Row icon={<SignalHigh className="size-4" />} label="Priority" hasSub />
        {sub === "priority" && (
          <SubMenu flip={flip}>
            {PRIORITIES.map((p) => (
              <Row
                key={p.value}
                icon={<span className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />}
                label={p.label}
                active={p.value === issue.priority}
                onClick={() => patch({ priority: p.value })}
              />
            ))}
          </SubMenu>
        )}
      </div>

      {/* Assignee */}
      <div className="relative" onMouseEnter={() => setSub("assignee")}>
        <Row icon={<UserIcon className="size-4" />} label="Assignee" hasSub />
        {sub === "assignee" && (
          <SubMenu flip={flip}>
            <Row
              icon={<span className="size-4 rounded-full border border-dashed border-border" />}
              label="Unassigned"
              active={!issue.assigneeId}
              onClick={() => patch({ assigneeId: null })}
            />
            {users.map((u) => (
              <Row
                key={u.id}
                icon={<Avatar name={u.name} src={u.avatarUrl} size={16} />}
                label={u.name}
                active={u.id === issue.assigneeId}
                onClick={() => patch({ assigneeId: u.id })}
              />
            ))}
          </SubMenu>
        )}
      </div>

      {/* Due date */}
      <div className="relative" onMouseEnter={() => setSub("due")}>
        <Row icon={<Calendar className="size-4" />} label="Due date" hasSub />
        {sub === "due" && (
          <SubMenu flip={flip}>
            <Row icon={<Calendar className="size-4" />} label="Today" onClick={() => patch({ dueDate: today })} />
            <Row icon={<Calendar className="size-4" />} label="Tomorrow" onClick={() => patch({ dueDate: addDays(today, 1) })} />
            <Row icon={<Calendar className="size-4" />} label="Next week" onClick={() => patch({ dueDate: addDays(today, 7) })} />
            <Row
              icon={<Calendar className="size-4" />}
              label="No due date"
              active={!issue.dueDate}
              onClick={() => patch({ dueDate: null })}
            />
          </SubMenu>
        )}
      </div>

      {/* Labels (multi-select, stays open) */}
      <div className="relative" onMouseEnter={() => setSub("labels")}>
        <Row icon={<Tag className="size-4" />} label="Labels" hasSub />
        {sub === "labels" && (
          <SubMenu flip={flip}>
            {(labels ?? []).length === 0 && (
              <div className="px-2.5 py-1.5 text-[12px] text-muted-foreground">No labels</div>
            )}
            {(labels ?? []).map((l) => (
              <Row
                key={l.id}
                icon={<span className="size-2.5 rounded-full" style={{ backgroundColor: l.color ?? "#6b7280" }} />}
                label={l.name ?? "label"}
                active={issue.labels.some((x) => x.id === l.id)}
                onClick={() => toggleLabel(l.id)}
              />
            ))}
          </SubMenu>
        )}
      </div>

      {/* Project */}
      <div className="relative" onMouseEnter={() => setSub("project")}>
        <Row icon={<Box className="size-4" />} label="Project" hasSub />
        {sub === "project" && (
          <SubMenu flip={flip}>
            <Row icon={<Box className="size-4" />} label="No project" active={!issue.projectId} onClick={() => patch({ projectId: null })} />
            {(filterOpts?.projects ?? []).map((p) => (
              <Row
                key={p.id}
                icon={<Box className="size-4" />}
                label={p.name}
                active={p.id === issue.projectId}
                onClick={() => patch({ projectId: p.id })}
              />
            ))}
          </SubMenu>
        )}
      </div>

      {/* Estimate */}
      <div className="relative" onMouseEnter={() => setSub("estimate")}>
        <Row icon={<Gauge className="size-4" />} label="Estimate" hasSub />
        {sub === "estimate" && (
          <SubMenu flip={flip}>
            <Row icon={<Gauge className="size-4" />} label="No estimate" active={issue.estimate == null} onClick={() => patch({ estimate: null })} />
            {ESTIMATES.map((n) => (
              <Row
                key={n}
                icon={<Gauge className="size-4" />}
                label={`${n} ${n === 1 ? "point" : "points"}`}
                active={issue.estimate === n}
                onClick={() => patch({ estimate: n })}
              />
            ))}
          </SubMenu>
        )}
      </div>

      {/* Cycle */}
      <div className="relative" onMouseEnter={() => setSub("cycle")}>
        <Row icon={<IterationCcw className="size-4" />} label="Cycle" hasSub />
        {sub === "cycle" && (
          <SubMenu flip={flip}>
            <Row icon={<IterationCcw className="size-4" />} label="No cycle" active={issue.cycleNumber == null} onClick={() => patch({ cycleId: null })} />
            {teamCycles.length === 0 && (
              <div className="px-2.5 py-1.5 text-[12px] text-muted-foreground">No cycles</div>
            )}
            {teamCycles.map((c) => (
              <Row
                key={c.id}
                icon={<IterationCcw className="size-4" />}
                label={c.name ?? `Cycle ${c.number ?? "?"}`}
                active={c.number != null && c.number === issue.cycleNumber}
                onClick={() => patch({ cycleId: c.id })}
              />
            ))}
          </SubMenu>
        )}
      </div>

      <div className="my-1 border-t border-border/60" />

      {/* Copy */}
      <div className="relative" onMouseEnter={() => setSub("copy")}>
        <Row icon={<Copy className="size-4" />} label="Copy" hasSub />
        {sub === "copy" && (
          <SubMenu flip={flip}>
            <Row icon={<Copy className="size-4" />} label="Copy ID" onClick={() => { copyText(issue.identifier, "ID"); onClose(); }} />
            <Row icon={<Copy className="size-4" />} label="Copy title" onClick={() => { copyText(issue.title, "Title"); onClose(); }} />
            <Row icon={<Copy className="size-4" />} label="Copy link" onClick={() => { copyText(issue.url, "Link"); onClose(); }} />
          </SubMenu>
        )}
      </div>

      {/* Open in Linear */}
      <Row
        icon={<ExternalLink className="size-4" />}
        label="Open in Linear"
        onMouseEnter={() => setSub(null)}
        onClick={() => {
          openUrl(issue.url).catch(() => gooeyToast.error("Couldn't open the link"));
          onClose();
        }}
      />

      <div className="my-1 border-t border-border/60" />

      {/* Open details (drawer) */}
      <Row
        icon={<PanelRight className="size-4" />}
        label="Open details"
        onMouseEnter={() => setSub(null)}
        onClick={() => {
          setParams({ issue: issue.id });
          onClose();
        }}
      />

      <div className="my-1 border-t border-border/60" />

      {/* Delete (confirm via submenu) */}
      <div className="relative" onMouseEnter={() => setSub("delete")}>
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-red-400 transition-colors hover:bg-red-500/10"
        >
          <span className="flex size-4 shrink-0 items-center justify-center">
            <Trash2 className="size-4" />
          </span>
          <span className="flex-1">Delete</span>
          <ChevronRight className="size-3.5 shrink-0 text-red-400/70" />
        </button>
        {sub === "delete" && (
          <SubMenu flip={flip}>
            <button
              type="button"
              onClick={removeIssue}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-red-400 transition-colors hover:bg-red-500/10"
            >
              <Trash2 className="size-4" />
              <span className="flex-1">Delete issue</span>
            </button>
          </SubMenu>
        )}
      </div>
    </div>
  );
}
