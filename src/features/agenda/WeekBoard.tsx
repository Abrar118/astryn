import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { CornerDownRight } from "lucide-react";
import type { Task } from "@/lib/tracker";
import { isOverdue } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { StatusIcon } from "@/features/drawer/issueGlyphs";
import { PriorityIcon } from "@/features/issues/IssueRow";
import { OVERDUE, dayDropId, dropDueDate, stepDay, type BoardColumn } from "./weekColumns";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 1" for a YYYY-MM-DD date. */
function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${MONTHS[d.getUTCMonth()] ?? ""} ${d.getUTCDate()}`;
}

type BoardProps = {
  columns: BoardColumn[];
  today: string;
  /** Id of the hint line that explains the board's keys. */
  hintId: string;
  parentOf: (task: Task) => Task | undefined;
  onOpen: (id: string) => void;
  onMenu: (e: MouseEvent, id: string) => void;
  /** Reschedule a task to a day (the caller runs the optimistic update). */
  onMove: (id: string, date: string) => void;
};

function CardBody({ task, parent, overdue, inOverdue }: { task: Task; parent?: Task; overdue: boolean; inOverdue: boolean }) {
  const closed = task.stateType === "completed" || task.stateType === "canceled";
  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className="flex shrink-0" title={task.stateName ?? undefined}>
          <StatusIcon type={task.stateType} color={task.stateColor} />
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground">{task.identifier}</span>
        {task.priority > 0 && <PriorityIcon p={task.priority} />}
      </div>
      <p className={cn("mt-1 line-clamp-2 text-[13px] leading-snug", closed ? "text-muted-foreground" : "text-foreground")}>
        {task.title}
      </p>
      {(parent || overdue) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
          {overdue && task.dueDate && (
            <span className="text-destructive tabular-nums">{inOverdue ? shortDate(task.dueDate) : "overdue"}</span>
          )}
          {parent && (
            <span className="flex min-w-0 items-center gap-1 text-muted-foreground" title={`Sub-issue of ${parent.identifier}: ${parent.title}`}>
              <CornerDownRight aria-hidden className="size-3 shrink-0" />
              <span className="truncate font-mono">{parent.identifier}</span>
            </span>
          )}
        </div>
      )}
    </>
  );
}

function Card({
  task,
  column,
  today,
  hintId,
  parent,
  register,
  onOpen,
  onMenu,
  onKey,
}: {
  task: Task;
  column: BoardColumn;
  today: string;
  hintId: string;
  parent?: Task;
  register: (id: string, el: HTMLElement | null) => void;
  onOpen: (id: string) => void;
  onMenu: (e: MouseEvent, id: string) => void;
  onKey: (e: KeyboardEvent, task: Task) => void;
}) {
  const drag = useDraggable({ id: task.id });
  const overdue = isOverdue(task.dueDate, task.stateType, today);
  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el);
        register(task.id, el);
      }}
      {...drag.listeners}
      role="button"
      tabIndex={0}
      aria-label={`${task.identifier}: ${task.title}${overdue ? `, overdue since ${shortDate(task.dueDate!)}` : ""}`}
      aria-describedby={hintId}
      data-card={task.id}
      data-overdue={overdue || undefined}
      onClick={() => onOpen(task.id)}
      onContextMenu={(e) => onMenu(e, task.id)}
      onKeyDown={(e) => onKey(e, task)}
      style={{ touchAction: "none" }}
      className={cn("week-card lt-card lt-focus cursor-grab select-none active:cursor-grabbing", drag.isDragging && "opacity-40")}
    >
      <CardBody task={task} parent={parent} overdue={overdue} inOverdue={column.key === OVERDUE} />
    </div>
  );
}

function Column({ column, today, children }: { column: BoardColumn; today: string; children: React.ReactNode }) {
  const isDay = column.date !== null;
  const { setNodeRef, isOver } = useDroppable({ id: column.date ? dayDropId(column.date) : OVERDUE, disabled: !isDay });
  const isToday = column.date === today;
  const count = column.cards.length;
  const alarm = column.key === OVERDUE && count > 0;
  return (
    <section
      ref={setNodeRef}
      aria-label={`${column.label}${isToday ? ", today" : ""}, ${count} ${count === 1 ? "task" : "tasks"}`}
      data-day={column.key}
      data-today={isToday || undefined}
      data-empty={count === 0 || undefined}
      data-over={(isOver && isDay) || undefined}
      className="week-col"
    >
      <header className="week-col-head">
        <span className={cn("text-[12px]", isToday ? "font-semibold text-foreground" : "text-muted-foreground", alarm && "text-destructive")}>
          {column.label}
        </span>
        {count > 0 && (
          <span aria-hidden className={cn("ml-auto text-[12px] tabular-nums", alarm ? "text-destructive" : "text-muted-foreground")}>
            {count}
          </span>
        )}
      </header>
      <div className="week-col-body drawer-scrollbar">{children}</div>
    </section>
  );
}

/**
 * The week as a planner: Overdue, then a column per day with the needle at
 * today. Drag a card onto another day to reschedule it; on the keyboard the
 * arrows move focus and Shift + ← / → moves the focused card a day.
 */
export function WeekBoard({ columns, today, hintId, parentOf, onOpen, onMenu, onMove }: BoardProps) {
  const [dragging, setDragging] = useState<Task | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const cards = useRef(new Map<string, HTMLElement>());
  // A card moved by keyboard remounts in its new column; focus follows it there.
  const pendingFocus = useRef<{ id: string; day: string } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const register = (id: string, el: HTMLElement | null) => {
    if (el) cards.current.set(id, el);
    else cards.current.delete(id);
  };

  useLayoutEffect(() => {
    const want = pendingFocus.current;
    if (!want) return;
    const el = cards.current.get(want.id);
    if (el?.closest("[data-day]")?.getAttribute("data-day") === want.day) {
      el.focus();
      pendingFocus.current = null;
    }
  });

  const all = columns.flatMap((c) => c.cards);
  const taskById = new Map(all.map((t) => [t.id, t]));
  const labelOf = (overId: UniqueIdentifier | undefined) =>
    columns.find((c) => c.date && dayDropId(c.date) === overId)?.label ?? "no day";
  const nameOf = (id: UniqueIdentifier) => taskById.get(String(id))?.identifier ?? "task";

  const move = (task: Task, date: string) => {
    if (date === task.dueDate) return;
    onMove(task.id, date);
    setAnnouncement(`Moved ${task.identifier} to ${columns.find((c) => c.date === date)?.label ?? date}.`);
  };

  const onKey = (e: KeyboardEvent, task: Task) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(task.id);
      return;
    }
    const col = columns.findIndex((c) => c.cards.some((t) => t.id === task.id));
    const row = columns[col]?.cards.findIndex((t) => t.id === task.id) ?? -1;
    if (col < 0) return;
    const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
    const vertical = e.key === "ArrowUp" || e.key === "ArrowDown";
    if (!horizontal && !vertical) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    // Arrows here belong to the board, not the screen's week keys.
    e.preventDefault();
    e.stopPropagation();
    const dir = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;

    if (e.shiftKey) {
      if (!horizontal) return;
      const date = stepDay(columns, columns[col].key, dir, today);
      if (!date) {
        setAnnouncement(dir === -1 ? "No earlier day on this board." : "No later day on this board.");
        return;
      }
      pendingFocus.current = { id: task.id, day: date };
      move(task, date);
      return;
    }

    let target: Task | undefined;
    if (vertical) {
      target = columns[col].cards[row + dir];
    } else {
      for (let c = col + dir; c >= 0 && c < columns.length; c += dir) {
        const list = columns[c].cards;
        if (list.length) {
          target = list[Math.min(row, list.length - 1)];
          break;
        }
      }
    }
    if (target) cards.current.get(target.id)?.focus();
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const task = taskById.get(String(e.active.id));
    const date = dropDueDate(task, e.over ? String(e.over.id) : null);
    if (task && date) move(task, date);
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) => `${nameOf(active.id)} is over ${labelOf(over?.id)}.`,
    onDragEnd: ({ active, over }) => `${nameOf(active.id)} dropped on ${labelOf(over?.id)}.`,
    onDragCancel: ({ active }) => `Moving ${nameOf(active.id)} was cancelled.`,
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      accessibility={{ announcements }}
      onDragStart={(e) => setDragging(taskById.get(String(e.active.id)) ?? null)}
      onDragCancel={() => setDragging(null)}
      onDragEnd={onDragEnd}
    >
      <div className="week-board" style={{ "--week-cols": columns.length } as CSSProperties}>
        {columns.map((column) => (
          <Column key={column.key} column={column} today={today}>
            {column.cards.map((task) => (
              <Card
                key={task.id}
                task={task}
                column={column}
                today={today}
                hintId={hintId}
                parent={parentOf(task)}
                register={register}
                onOpen={onOpen}
                onMenu={onMenu}
                onKey={onKey}
              />
            ))}
          </Column>
        ))}
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div className="week-card lt-card cursor-grabbing shadow-[0_8px_24px_var(--overlay-shadow)]">
            <CardBody
              task={dragging}
              parent={parentOf(dragging)}
              overdue={isOverdue(dragging.dueDate, dragging.stateType, today)}
              inOverdue={columns.find((c) => c.cards.includes(dragging))?.key === OVERDUE}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
