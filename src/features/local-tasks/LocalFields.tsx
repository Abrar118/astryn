/** Small shared controls for local tasks: status, priority, assignee and sprint pickers, and row pills. */
import type { ReactNode } from "react";
import { CalendarDays, CheckSquare, ChevronDown, GitFork, IterationCcw, User } from "lucide-react";
import { Popover, PopoverItem } from "@/components/Popover";
import { StatusIcon } from "@/features/drawer/issueGlyphs";
import { PRIORITIES } from "@/features/issues/issueFields";
import { dueLabel } from "@/features/issues/IssueRow";
import type { LocalSprint, LocalStatus, LocalTask } from "@/lib/commands";
import { LOCAL_ME } from "@/lib/tracker";
import { isOverdue } from "@/lib/dates";
import { cn } from "@/lib/utils";

const TRIGGER =
  "flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
const PANEL = "max-h-72 w-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-2xl";

export function PriorityDot({ value }: { value: number }) {
  const p = PRIORITIES.find((x) => x.value === value) ?? PRIORITIES[PRIORITIES.length - 1];
  return <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />;
}

export function priorityLabel(value: number): string {
  return (PRIORITIES.find((x) => x.value === value) ?? PRIORITIES[PRIORITIES.length - 1]).label;
}

export function StatusSelect({
  statuses,
  value,
  onChange,
  compact,
  label = "Status",
}: {
  statuses: LocalStatus[];
  value: string | null;
  onChange: (id: string) => void;
  compact?: boolean;
  label?: string;
}) {
  const current = statuses.find((s) => s.id === value);
  return (
    <Popover
      buttonTitle={label}
      buttonClassName={compact ? "flex shrink-0 cursor-pointer items-center rounded p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" : TRIGGER}
      panelClassName={PANEL}
      button={
        compact ? (
          <StatusIcon type={current?.category ?? "unstarted"} color={current?.color ?? ""} />
        ) : (
          <>
            <StatusIcon type={current?.category ?? "unstarted"} color={current?.color ?? ""} />
            <span className="truncate">{current?.name ?? "Status"}</span>
          </>
        )
      }
    >
      {(close) =>
        statuses.map((s) => (
          <PopoverItem
            key={s.id}
            icon={<StatusIcon type={s.category} color={s.color} />}
            label={s.name}
            active={s.id === value}
            onClick={() => (onChange(s.id), close())}
          />
        ))
      }
    </Popover>
  );
}

export function PrioritySelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <Popover
      buttonTitle="Priority"
      buttonClassName={TRIGGER}
      panelClassName={PANEL}
      button={
        <>
          <PriorityDot value={value} />
          <span className={cn("truncate", value === 0 && "text-muted-foreground")}>{priorityLabel(value)}</span>
        </>
      }
    >
      {(close) =>
        PRIORITIES.map((p) => (
          <PopoverItem
            key={p.value}
            icon={<PriorityDot value={p.value} />}
            label={p.label}
            active={p.value === value}
            onClick={() => (onChange(p.value), close())}
          />
        ))
      }
    </Popover>
  );
}

export function AssigneeToggle({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const mine = value === LOCAL_ME;
  return (
    <Popover
      buttonTitle="Assignee"
      buttonClassName={TRIGGER}
      panelClassName={PANEL}
      button={
        <>
          <User className="size-3.5 text-muted-foreground" />
          <span className={cn(!mine && "text-muted-foreground")}>{mine ? "Me" : "Unassigned"}</span>
        </>
      }
    >
      {(close) => (
        <>
          <PopoverItem label="Me" active={mine} onClick={() => (onChange(LOCAL_ME), close())} />
          <PopoverItem label="Unassigned" active={!mine} onClick={() => (onChange(null), close())} />
        </>
      )}
    </Popover>
  );
}

export function SprintSelect({
  sprints,
  value,
  onChange,
}: {
  sprints: LocalSprint[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const current = sprints.find((s) => s.id === value);
  return (
    <Popover
      buttonTitle="Sprint"
      buttonClassName={TRIGGER}
      panelClassName={PANEL}
      disabled={sprints.length === 0}
      button={
        <>
          <IterationCcw className="size-3.5 text-muted-foreground" />
          <span className={cn("truncate", !current && "text-muted-foreground")}>
            {current ? current.name : sprints.length === 0 ? "No sprints yet" : "No sprint"}
          </span>
        </>
      }
    >
      {(close) => (
        <>
          <PopoverItem label="No sprint" active={!value} onClick={() => (onChange(null), close())} />
          {sprints.map((s) => (
            <PopoverItem key={s.id} label={s.name} active={s.id === value} onClick={() => (onChange(s.id), close())} />
          ))}
        </>
      )}
    </Popover>
  );
}

/** A quiet 11px pill (DESIGN.md "Pill"). */
export function Pill({ children, tone, title }: { children: ReactNode; tone?: "danger"; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        tone === "danger" ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** The right-aligned metadata cluster of a task row or card. */
export function TaskMeta({ task, today, subtasks = 0 }: { task: LocalTask; today: string; subtasks?: number }) {
  const overdue = isOverdue(task.dueDate, task.stateType, today);
  return (
    <>
      {task.labels.slice(0, 2).map((l) => (
        <Pill key={l.id}>
          <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: l.color ?? undefined }} />
          {l.name}
        </Pill>
      ))}
      {subtasks > 0 && (
        <Pill title={`${subtasks} subtask${subtasks === 1 ? "" : "s"}`}>
          <GitFork className="size-3" />
          {subtasks}
        </Pill>
      )}
      {task.checklistTotal > 0 && (
        <Pill title="Checklist">
          <CheckSquare className="size-3" />
          <span className="tabular-nums">
            {task.checklistDone}/{task.checklistTotal}
          </span>
        </Pill>
      )}
      {task.cycleName && <Pill>{task.cycleName}</Pill>}
      {task.dueDate && (
        <Pill tone={overdue ? "danger" : undefined} title={overdue ? "Overdue" : "Due date"}>
          <CalendarDays className="size-3" />
          {dueLabel(task.dueDate, today)}
        </Pill>
      )}
      {task.priority !== 0 && (
        <span title={priorityLabel(task.priority)} className="flex shrink-0 items-center">
          <PriorityDot value={task.priority} />
        </span>
      )}
      {task.assigneeId === LOCAL_ME && (
        <span title="Assigned to me" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-foreground">
          Me
        </span>
      )}
    </>
  );
}

export function Caret({ open }: { open: boolean }) {
  return <ChevronDown aria-hidden className={cn("size-3.5 text-muted-foreground transition-transform", !open && "-rotate-90")} />;
}
