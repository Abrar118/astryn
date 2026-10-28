import { useState, type MouseEvent } from "react";
import { ChevronRight } from "lucide-react";
import type { LocalStatus, LocalTask } from "@/lib/commands";
import { useUpdateTask } from "@/lib/taskQueries";
import { cn } from "@/lib/utils";
import { StatusIcon } from "@/features/drawer/issueGlyphs";
import { groupByStatus, subtasksOf } from "../localTaskModel";
import { Caret, StatusSelect, TaskMeta } from "../LocalFields";
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
  return (
    <div
      role="row"
      onContextMenu={(e) => props.onMenu(e, task.id)}
      className="group flex items-center gap-2 border-b border-border/40 px-3 py-1.5 hover:bg-accent/50"
      style={{ paddingLeft: 12 + depth * 22 }}
    >
      {subtaskCount > 0 ? (
        <button
          type="button"
          aria-label={expanded ? "Hide subtasks" : "Show subtasks"}
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
        </button>
      ) : (
        <span className="size-4 shrink-0" />
      )}
      <StatusSelect
        compact
        statuses={props.statuses}
        value={task.stateId}
        onChange={(stateId) => update.mutate({ id: task.id, patch: { stateId } })}
      />
      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{task.identifier}</span>
      <button
        type="button"
        onClick={() => props.onOpen(task.id)}
        className={cn(
          "min-w-0 flex-1 cursor-pointer truncate text-left text-sm text-foreground focus-visible:outline-none focus-visible:underline",
          (task.stateType === "completed" || task.stateType === "canceled") && "text-muted-foreground line-through decoration-muted-foreground/50",
        )}
      >
        {task.title}
      </button>
      <div className="flex shrink-0 items-center gap-1.5">
        <TaskMeta task={task} today={props.today} subtasks={subtaskCount} />
      </div>
    </div>
  );
}

/** Tasks grouped by status (ClickUp's list), collapsible groups, subtasks nested, inline add per group. */
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
    <div role="table" aria-label="Tasks by status" className="pb-24">
      {groups.map((g, i) => {
        const isCollapsed = collapsed.has(g.status.id);
        return (
          <section key={g.status.id} aria-label={g.status.name}>
            <button
              type="button"
              aria-expanded={!isCollapsed}
              onClick={() => setCollapsed((s) => toggle(s, g.status.id))}
              className="sticky top-0 z-10 flex w-full cursor-pointer items-center gap-2 bg-background px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <Caret open={!isCollapsed} />
              <StatusIcon type={g.status.category} color={g.status.color} />
              <span className="text-[13px] font-semibold text-foreground">{g.status.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{g.tasks.length}</span>
            </button>
            {!isCollapsed && (
              <>
                {g.tasks.map((t) => renderTask(t, 0))}
                <QuickAdd
                  base={{ listId: props.listId, statusId: g.status.id }}
                  className="pl-9"
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
