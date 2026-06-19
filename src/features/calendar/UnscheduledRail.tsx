import { useEffect, useRef } from "react";
import { Draggable } from "@fullcalendar/interaction";
import type { CalendarIssue } from "@/lib/commands";

export function UnscheduledRail({
  issues,
  onOpen,
}: {
  issues: CalendarIssue[];
  onOpen: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    // create:false => FullCalendar adds no internal event on drop; our cache drives
    // rendering. The calendar's `drop` callback still fires with the target date.
    const d = new Draggable(ref.current, {
      itemSelector: ".astryn-rail-item",
      eventData: () => ({ create: false }),
    });
    return () => d.destroy();
  }, []);

  return (
    <aside
      id="astryn-unscheduled"
      ref={ref}
      className="flex w-64 shrink-0 flex-col border-l border-border"
    >
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Unscheduled
        </span>
        <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {issues.length}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-3">
        {issues.map((i) => (
          <div
            key={i.id}
            data-id={i.id}
            onClick={() => onOpen(i.id)}
            title={i.title}
            className="astryn-rail-item cursor-grab rounded-md border border-border/60 px-2.5 py-2 text-xs transition-colors hover:border-border hover:bg-accent active:cursor-grabbing"
          >
            <div className="flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: i.stateColor || "#6b7280" }}
              />
              <span className="font-medium text-muted-foreground">{i.identifier}</span>
            </div>
            <div className="mt-0.5 line-clamp-2 text-foreground">{i.title}</div>
          </div>
        ))}
        {issues.length === 0 && (
          <div className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
            Nothing unscheduled.
          </div>
        )}
      </div>
    </aside>
  );
}
