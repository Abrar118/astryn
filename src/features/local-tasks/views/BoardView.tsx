import { useId, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { LocalStatus, LocalTask } from "@/lib/commands";
import { useUpdateTask } from "@/lib/taskQueries";
import { cn } from "@/lib/utils";
import { StatusIcon } from "@/features/drawer/issueGlyphs";
import { groupByStatus, positionBefore, subtasksOf } from "../localTaskModel";
import { TaskMeta } from "../LocalFields";
import { QuickAdd } from "../QuickAdd";
import type { ViewProps } from "./ListView";

const CARD = "rounded-[10px] border border-border bg-card px-3 py-2.5 text-left";

function CardBody({ task, today, subtasks }: { task: LocalTask; today: string; subtasks: number }) {
  return (
    <>
      <div className="mb-1 font-mono text-[11px] text-muted-foreground">{task.identifier}</div>
      <div className="mb-2 line-clamp-3 text-[13px] font-medium leading-snug text-foreground">{task.title}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <TaskMeta task={task} today={today} subtasks={subtasks} />
      </div>
    </>
  );
}

function Card({ task, props, subtasks }: { task: LocalTask; props: ViewProps; subtasks: number }) {
  const drag = useDraggable({ id: task.id });
  const drop = useDroppable({ id: `card:${task.id}` });
  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      {...drag.attributes}
      {...drag.listeners}
      // Enter opens the task; Space (the sensor's key) picks it up to move.
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          props.onOpen(task.id);
          return;
        }
        drag.listeners?.onKeyDown?.(e);
      }}
      onClick={() => props.onOpen(task.id)}
      onContextMenu={(e) => props.onMenu(e, task.id)}
      style={{ touchAction: "none" }}
      className={cn(
        CARD,
        "cursor-grab select-none transition-colors hover:border-foreground/20 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        drag.isDragging && "opacity-40",
        drop.isOver && !drag.isDragging && "border-t-2 border-t-primary",
      )}
    >
      <CardBody task={task} today={props.today} subtasks={subtasks} />
    </div>
  );
}

function Column({ status, count, children }: { status: LocalStatus; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status.id}` });
  return (
    <section
      ref={setNodeRef}
      aria-label={status.name}
      className={cn("flex w-72 shrink-0 flex-col rounded-[14px] bg-sidebar/60 transition-colors", isOver && "bg-accent/40")}
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <StatusIcon type={status.category} color={status.color} />
        <span className="text-[13px] font-semibold text-foreground">{status.name}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      </header>
      <div className="flex min-h-16 flex-col gap-2 overflow-y-auto px-2 pb-2">{children}</div>
    </section>
  );
}

/** A column per status; drag a card to another column to change its status, or onto a card to place it before. */
export function BoardView(props: ViewProps) {
  const groups = groupByStatus(props.tasks, props.statuses);
  const update = useUpdateTask();
  const [dragging, setDragging] = useState<LocalTask | null>(null);
  const hintId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Space picks up and drops a card; Enter stays free to open it.
    useSensor(KeyboardSensor, { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const id = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    const task = props.tasks.find((t) => t.id === id);
    if (!over || !task) return;
    if (over.startsWith("col:")) {
      const stateId = over.slice(4);
      const group = groups.find((g) => g.status.id === stateId);
      if (stateId === task.stateId) return;
      const last = group?.tasks[group.tasks.length - 1];
      update.mutate({ id, patch: { stateId, position: positionBefore(last?.position, undefined) } });
      return;
    }
    const targetId = over.slice(5);
    if (targetId === id) return;
    const group = groups.find((g) => g.tasks.some((t) => t.id === targetId));
    if (!group) return;
    const idx = group.tasks.findIndex((t) => t.id === targetId);
    const before = group.tasks.slice(0, idx).filter((t) => t.id !== id);
    const position = positionBefore(before[before.length - 1]?.position, group.tasks[idx].position);
    update.mutate({
      id,
      patch: group.status.id === task.stateId ? { position } : { stateId: group.status.id, position },
    });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e) => setDragging(props.tasks.find((t) => t.id === e.active.id) ?? null)}
      onDragCancel={() => setDragging(null)}
      onDragEnd={onDragEnd}
    >
      <p id={hintId} className="px-4 pt-3 text-[11px] text-muted-foreground">
        Drag a card to change its status. From the keyboard: Enter opens a card; Space picks it up, arrow keys move it,
        Space drops it, Escape cancels.
      </p>
      <div className="flex h-full gap-3 overflow-x-auto p-4 pb-24" aria-describedby={hintId}>
        {groups.map((g, i) => (
          <Column key={g.status.id} status={g.status} count={g.tasks.length}>
            {g.tasks.map((t) => (
              <Card key={t.id} task={t} props={props} subtasks={subtasksOf(props.tasks, t.id).length} />
            ))}
            <QuickAdd base={{ listId: props.listId, statusId: g.status.id }} autoOpen={i === 0 ? props.addSignal : 0} />
          </Column>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div className={cn(CARD, "w-68 cursor-grabbing shadow-2xl")}>
            <CardBody task={dragging} today={props.today} subtasks={0} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
