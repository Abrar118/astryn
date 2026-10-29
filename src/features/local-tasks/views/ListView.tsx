import { useState, type MouseEvent } from "react";
import { ChevronRight } from "lucide-react";
import type { LocalStatus, LocalTask } from "@/lib/commands";
import { useUpdateTask } from "@/lib/taskQueries";
import { cn } from "@/lib/utils";
import { StatusIcon } from "@/features/drawer/issueGlyphs";
import { groupByStatus, subtasksOf } from "../localTaskModel";
import { Caret, DueText, RowAssignee, RowPriority, StatusSelect, TaskMeta } from "../LocalFields";
import { QuickAdd } from "../QuickAdd";

export type ViewProps = {
  /** The tasks to show (already filtered). */
  tasks: LocalTask[];
  statuses: LocalStatus[];
  listId: string;
  today: string;
  onOpen: (id: string) => void;
  onMenu: (e: MouseEvent, id: string) => void;
  /** Bumped by the N shortcut to open the first inline add. */
  addSignal?: number;
};

function Row({
  task,
  depth,
  props,
  subtaskCount,
  expanded,
  onToggle,
}: {
  task: LocalTask;
  depth: number;
  props: ViewProps;
  subtaskCount: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const update = useUpdateTask();
  const closed = task.stateType === "completed" || task.stateType === "canceled";
  return (
    <div
      role="row"
      onContextMenu={(e) => props.onMenu(e, task.id)}
      className="lt-row"
      style={{ paddingLeft: 12 + depth * 22 }}
    >
      {subtaskCount > 0 ? (
        <button
          type="button"
          aria-label={expanded ? "Hide subtasks" : "Show subtasks"}
          aria-expanded={expanded}
          onClick={onToggle}
          className="lt-focus flex size-4 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
        </button>
      ) : (
        <span />
      )}
      <StatusSelect
        compact
        statuses={props.statuses}
        value={task.stateId}
        onChange={(stateId) => update.mutate({ id: task.id, patch: { stateId } })}
      />
      <span className="lt-row-id truncate font-mono text-[12px] text-muted-foreground">{task.identifier}</span>
      <button
        type="button"
        onClick={() => props.onOpen(task.id)}
        className={cn(
          "lt-focus min-w-0 cursor-pointer truncate rounded-sm text-left text-[14px] text-foreground",
          closed && "text-muted-foreground line-through decoration-muted-foreground/50",
        )}
      >
        {task.title}
      </button>
      <TaskMeta task={task} subtasks={subtaskCount} className="lt-row-meta justify-end" />
      <DueText task={task} today={props.today} className="text-right" />
      <RowPriority value={task.priority} />
      <RowAssignee task={task} className="lt-row-who text-right" />
    </div>
  );
}

/** Tasks grouped by status, collapsible groups, subtasks nested, inline add per group. */
export function ListView(props: ViewProps) {
  const groups = groupByStatus(props.tasks, props.statuses);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const renderTask = (t: LocalTask, depth: number) => {
    const subs = subtasksOf(props.tasks, t.id);
    const open = expanded.has(t.id);
    return (
      <div key={t.id}>
        <Row
          task={t}
          depth={depth}
          props={props}
          subtaskCount={subs.length}
          expanded={open}
          onToggle={() => setExpanded((s) => toggle(s, t.id))}
        />
        {open && subs.map((s) => renderTask(s, depth + 1))}
      </div>
    );
  };

  return (
    <div role="table" aria-label="Tasks by status" className="pb-28">
      {groups.map((g, i) => {
        const isCollapsed = collapsed.has(g.status.id);
        return (
          <section key={g.status.id} aria-label={g.status.name}>
            <button
              type="button"
              aria-expanded={!isCollapsed}
              onClick={() => setCollapsed((s) => toggle(s, g.status.id))}
              className="lt-focus sticky top-0 z-10 flex h-10 w-full cursor-pointer items-center gap-2 border-b border-border bg-background px-3 text-left"
            >
              <Caret open={!isCollapsed} />
              <StatusIcon type={g.status.category} color={g.status.color} />
              <span className="text-[13px] font-semibold tracking-tight text-foreground">{g.status.name}</span>
              <span className="text-[12px] tabular-nums text-muted-foreground">{g.tasks.length}</span>
            </button>
            {!isCollapsed && (
              <>
                {g.tasks.map((t) => renderTask(t, 0))}
                <QuickAdd
                  base={{ listId: props.listId, statusId: g.status.id }}
                  className="rounded-none pl-[42px]"
                  autoOpen={i === 0 ? props.addSignal : 0}
                />
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
