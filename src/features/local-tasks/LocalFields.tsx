/** Small shared controls for local tasks: status, priority, assignee and sprint pickers, and row metadata. */
import { CheckSquare, ChevronDown, GitFork, IterationCcw, User } from "lucide-react";
import { Popover, PopoverItem } from "@/components/Popover";
import { IndicatorLamp, type Lamp } from "@/components/IndicatorLamp";
import { StatusIcon } from "@/features/drawer/issueGlyphs";
import { PRIORITIES } from "@/features/issues/issueFields";
import { dueLabel } from "@/features/issues/IssueRow";
import type { LocalSprint, LocalStatus, LocalTask } from "@/lib/commands";
import { LOCAL_ME } from "@/lib/tracker";
import { isOverdue } from "@/lib/dates";
import { cn } from "@/lib/utils";

const TRIGGER =
  "lt-focus flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60";
export const PANEL = "lt-overlay max-h-72 w-56 overflow-y-auto rounded-lg border border-border bg-popover p-1";

/** Priority Mapping Rule: Urgent = destructive, High = warning, Medium = info, Low = muted; none is an unlit ring. */
const PRIORITY_LAMP: Record<number, Lamp> = { 1: "danger", 2: "warning", 3: "info", 4: "neutral", 0: "off" };

export function PriorityLamp({ value, className }: { value: number; className?: string }) {
  return <IndicatorLamp tone={PRIORITY_LAMP[value] ?? "off"} className={className} />;
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
      buttonClassName={compact ? "lt-focus flex shrink-0 cursor-pointer items-center rounded p-0.5 hover:bg-accent" : TRIGGER}
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
          <PriorityLamp value={value} />
          <span className={cn("truncate", value === 0 && "text-muted-foreground")}>{priorityLabel(value)}</span>
        </>
      }
    >
      {(close) =>
        PRIORITIES.map((p) => (
          <PopoverItem
            key={p.value}
            icon={<PriorityLamp value={p.value} />}
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

/** Labels, subtasks, checklist and sprint as quiet inline text (no pills). */
export function TaskMeta({ task, subtasks = 0, className }: { task: LocalTask; subtasks?: number; className?: string }) {
  const sub = `${subtasks} subtask${subtasks === 1 ? "" : "s"}`;
  return (
    <span className={cn("flex min-w-0 items-center gap-3 text-[12px] text-muted-foreground", className)}>
      {task.labels.slice(0, 2).map((l) => (
        <span key={l.id} className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: l.color ?? undefined }} />
          <span className="truncate">{l.name}</span>
        </span>
      ))}
      {subtasks > 0 && (
        <span title={sub} className="flex shrink-0 items-center gap-1 tabular-nums">
          <GitFork aria-hidden className="size-3" />
          <span className="sr-only">{sub}</span>
          <span aria-hidden>{subtasks}</span>
        </span>
      )}
      {task.checklistTotal > 0 && (
        <span title="Checklist" className="flex shrink-0 items-center gap-1 tabular-nums">
          <CheckSquare aria-hidden className="size-3" />
          <span className="sr-only">Checklist</span>
          {task.checklistDone}/{task.checklistTotal}
        </span>
      )}
      {task.cycleName && <span className="truncate">{task.cycleName}</span>}
    </span>
  );
}

/** The due date as text: destructive when overdue, empty when there is none. */
export function DueText({ task, today, className }: { task: LocalTask; today: string; className?: string }) {
  if (!task.dueDate) return <span className={className} />;
  const overdue = isOverdue(task.dueDate, task.stateType, today);
  return (
    <span
      title={overdue ? "Overdue" : "Due date"}
      className={cn("truncate text-[12px] tabular-nums", overdue ? "text-destructive" : "text-muted-foreground", className)}
    >
      {overdue && <span className="sr-only">Overdue, </span>}
      {dueLabel(task.dueDate, today)}
    </span>
  );
}

/** Priority lamp for a row; nothing for "No priority". */
export function RowPriority({ value }: { value: number }) {
  if (value === 0) return <span />;
  return (
    <span title={priorityLabel(value)} className="flex items-center">
      <PriorityLamp value={value} />
      <span className="sr-only">{priorityLabel(value)} priority</span>
    </span>
  );
}

/** "me" when the task is assigned to the owner. */
export function RowAssignee({ task, className }: { task: LocalTask; className?: string }) {
  return (
    <span title={task.assigneeId === LOCAL_ME ? "Assigned to me" : undefined} className={cn("text-[12px] text-muted-foreground", className)}>
      {task.assigneeId === LOCAL_ME ? "me" : ""}
    </span>
  );
}

export function Caret({ open }: { open: boolean }) {
  return <ChevronDown aria-hidden className={cn("size-3.5 text-muted-foreground transition-transform", !open && "-rotate-90")} />;
}

/** A lamp and a line of text: loading, empty and error states on the faceplate. */
export function LampMessage({ tone, title, body }: { tone: Lamp; title: string; body?: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-6">
      <IndicatorLamp tone={tone} className="mt-1.5" />
      <div>
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        {body && <p className="mt-0.5 text-[12px] text-muted-foreground">{body}</p>}
      </div>
    </div>
  );
}
