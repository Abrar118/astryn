import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Box,
  Check,
  Gauge,
  IterationCcw,
  ListChecks,
  SignalHigh,
  Tag,
  X,
} from "lucide-react";
import {
  useCreateIssue,
  useCycles,
  useFilterOptions,
  useIssues,
  useLabels,
  useMe,
  useUsers,
} from "@/lib/queries";
import type { CreateIssueInput } from "@/lib/commands";
import { AssigneeSelect } from "@/components/AssigneeSelect";
import { DatePicker } from "@/components/DatePicker";

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

/** A pill button that opens a small popover; `children` receives a `close` fn. */
function Pop({
  icon,
  label,
  active,
  children,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), setOpen(false));
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent ${
          active ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        <span className="flex size-3.5 items-center justify-center">{icon}</span>
        <span className="max-w-[10rem] truncate">{label}</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-10 mb-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-2xl">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function Opt({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-accent"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {active && <Check className="size-3.5 shrink-0 text-primary" />}
    </button>
  );
}

const dot = (color: string) => <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />;

export function CreateIssueModal({ onClose }: { onClose: () => void }) {
  const { data: teamsOpts } = useFilterOptions();
  const { data: allIssues } = useIssues({});
  const { data: users } = useUsers();
  const { data: labels } = useLabels();
  const { data: cycles } = useCycles();
  const { data: me } = useMe();
  const create = useCreateIssue();
  const [, setParams] = useSearchParams();

  const teams = teamsOpts?.teams ?? [];
  const projects = teamsOpts?.projects ?? [];

  const [teamId, setTeamId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [stateId, setStateId] = useState<string | null>(null);
  const [priority, setPriority] = useState(0);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [createMore, setCreateMore] = useState(false);

  const titleRef = useRef<HTMLTextAreaElement>(null);

  // Default the team to the first available, and the assignee to me, once loaded.
  useEffect(() => {
    if (!teamId && teams.length) setTeamId(teams[0].id);
  }, [teams, teamId]);
  useEffect(() => {
    if (assigneeId === null && me?.viewerId) setAssigneeId(me.viewerId);
    // only seed once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.viewerId]);
  useEffect(() => titleRef.current?.focus(), []);

  // States are team-scoped; derive the picker options from cached issues of this team.
  const teamStates = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; color: string; type: string }>();
    for (const i of allIssues ?? []) {
      if (i.teamId === teamId && i.stateId && i.stateName) {
        seen.set(i.stateId, { id: i.stateId, name: i.stateName, color: i.stateColor, type: i.stateType });
      }
    }
    return [...seen.values()].sort((a, b) => (STATE_RANK[a.type] ?? 9) - (STATE_RANK[b.type] ?? 9));
  }, [allIssues, teamId]);

  const teamCycles = useMemo(
    () => (cycles ?? []).filter((c) => c.teamId === teamId).sort((a, b) => (b.number ?? 0) - (a.number ?? 0)),
    [cycles, teamId],
  );

  // Reset the per-issue fields after a "create more" submit; keep team + status.
  const resetForNext = () => {
    setTitle("");
    setDescription("");
    setPriority(0);
    setProjectId(null);
    setEstimate(null);
    setLabelIds([]);
    setCycleId(null);
    setDueDate(null);
    titleRef.current?.focus();
  };

  const submit = () => {
    const t = title.trim();
    if (!t || !teamId || create.isPending) return;
    const input: CreateIssueInput = {
      teamId,
      title: t,
      description: description.trim() || undefined,
      stateId: stateId ?? undefined,
      priority: priority || undefined,
      assigneeId: assigneeId ?? undefined,
      projectId: projectId ?? undefined,
      estimate: estimate ?? undefined,
      labelIds: labelIds.length ? labelIds : undefined,
      cycleId: cycleId ?? undefined,
      dueDate: dueDate ?? undefined,
    };
    create.mutate(input, {
      onSuccess: (issue) => {
        if (createMore) resetForNext();
        else {
          setParams({ issue: issue.id });
          onClose();
        }
      },
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  const team = teams.find((t) => t.id === teamId);
  const curState = teamStates.find((s) => s.id === stateId);
  const curPriority = PRIORITIES.find((p) => p.value === priority);
  const curProject = projects.find((p) => p.id === projectId);
  const curCycle = teamCycles.find((c) => c.id === cycleId);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh]" onMouseDown={onClose}>
      <div
        className="flex w-[min(680px,92vw)] flex-col rounded-xl border border-border bg-card shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 pt-3.5 text-sm">
          <span className="rounded-md bg-secondary/60 px-2 py-0.5 text-xs font-semibold text-foreground">
            {team?.key ?? "—"}
          </span>
          <span className="text-muted-foreground">›</span>
          <span className="text-muted-foreground">New issue</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Title + description */}
        <div className="px-4 pt-2">
          <textarea
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Issue title"
            className="w-full resize-none bg-transparent text-lg font-medium text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Add description…"
            className="mt-1 w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
        </div>

        {/* Property pills */}
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
          <Pop icon={<Box className="size-3.5" />} label={team?.key ?? "Team"} active={!!team}>
            {(close) =>
              teams.map((t) => (
                <Opt
                  key={t.id}
                  icon={<Box className="size-4" />}
                  label={t.key}
                  active={t.id === teamId}
                  onClick={() => {
                    setTeamId(t.id);
                    setStateId(null);
                    setCycleId(null);
                    close();
                  }}
                />
              ))
            }
          </Pop>

          <Pop icon={curState ? dot(curState.color) : <ListChecks className="size-3.5" />} label={curState?.name ?? "Status"} active={!!curState}>
            {(close) => (
              <>
                {teamStates.length === 0 && <div className="px-2.5 py-1.5 text-[12px] text-muted-foreground">No states cached</div>}
                {teamStates.map((s) => (
                  <Opt key={s.id} icon={dot(s.color)} label={s.name} active={s.id === stateId} onClick={() => (setStateId(s.id), close())} />
                ))}
              </>
            )}
          </Pop>

          <Pop icon={curPriority && priority ? dot(curPriority.color) : <SignalHigh className="size-3.5" />} label={priority ? curPriority!.label : "Priority"} active={!!priority}>
            {(close) =>
              PRIORITIES.map((p) => (
                <Opt key={p.value} icon={dot(p.color)} label={p.label} active={p.value === priority} onClick={() => (setPriority(p.value), close())} />
              ))
            }
          </Pop>

          <AssigneeSelect value={assigneeId} onChange={setAssigneeId} users={users ?? []} meId={me?.viewerId} emptyLabel="Assignee" />

          <Pop icon={<Box className="size-3.5" />} label={curProject?.name ?? "Project"} active={!!curProject}>
            {(close) => (
              <>
                <Opt icon={<Box className="size-4" />} label="No project" active={!projectId} onClick={() => (setProjectId(null), close())} />
                {projects.map((p) => (
                  <Opt key={p.id} icon={<Box className="size-4" />} label={p.name} active={p.id === projectId} onClick={() => (setProjectId(p.id), close())} />
                ))}
              </>
            )}
          </Pop>

          <Pop icon={<Gauge className="size-3.5" />} label={estimate != null ? `${estimate}` : "Estimate"} active={estimate != null}>
            {(close) => (
              <>
                <Opt icon={<Gauge className="size-4" />} label="No estimate" active={estimate == null} onClick={() => (setEstimate(null), close())} />
                {ESTIMATES.map((n) => (
                  <Opt key={n} icon={<Gauge className="size-4" />} label={`${n} ${n === 1 ? "point" : "points"}`} active={estimate === n} onClick={() => (setEstimate(n), close())} />
                ))}
              </>
            )}
          </Pop>

          <Pop icon={<Tag className="size-3.5" />} label={labelIds.length ? `${labelIds.length} label${labelIds.length > 1 ? "s" : ""}` : "Labels"} active={labelIds.length > 0}>
            {() => (
              <>
                {(labels ?? []).length === 0 && <div className="px-2.5 py-1.5 text-[12px] text-muted-foreground">No labels</div>}
                {(labels ?? []).map((l) => (
                  <Opt
                    key={l.id}
                    icon={dot(l.color ?? "#6b7280")}
                    label={l.name ?? "label"}
                    active={labelIds.includes(l.id)}
                    onClick={() =>
                      setLabelIds((ids) => (ids.includes(l.id) ? ids.filter((x) => x !== l.id) : [...ids, l.id]))
                    }
                  />
                ))}
              </>
            )}
          </Pop>

          <Pop icon={<IterationCcw className="size-3.5" />} label={curCycle ? curCycle.name ?? `Cycle ${curCycle.number ?? "?"}` : "Cycle"} active={!!curCycle}>
            {(close) => (
              <>
                <Opt icon={<IterationCcw className="size-4" />} label="No cycle" active={!cycleId} onClick={() => (setCycleId(null), close())} />
                {teamCycles.length === 0 && <div className="px-2.5 py-1.5 text-[12px] text-muted-foreground">No cycles</div>}
                {teamCycles.map((c) => (
                  <Opt key={c.id} icon={<IterationCcw className="size-4" />} label={c.name ?? `Cycle ${c.number ?? "?"}`} active={c.id === cycleId} onClick={() => (setCycleId(c.id), close())} />
                ))}
              </>
            )}
          </Pop>

          <DatePicker
            value={dueDate}
            onChange={setDueDate}
            placeholder="Due date"
            triggerClassName="flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={() => setCreateMore((v) => !v)}
            className="flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className={`relative h-4 w-7 rounded-full transition-colors ${createMore ? "bg-primary" : "bg-secondary"}`}>
              <span className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${createMore ? "left-3.5" : "left-0.5"}`} />
            </span>
            Create more
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!title.trim() || !teamId || create.isPending}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create issue"}
          </button>
        </div>
      </div>
    </div>
  );
}
