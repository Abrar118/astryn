import { useEffect, useRef } from "react";
import { Draggable } from "@fullcalendar/interaction";
import type { CalendarIssue } from "@/lib/commands";

export function UnscheduledRail({
  issues, onOpen,
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
    <aside id="astryn-unscheduled" ref={ref} className="w-64 shrink-0 border-l p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Unscheduled ({issues.length})
      </div>
      <div className="flex flex-col gap-1">
        {issues.map((i) => (
          <div
            key={i.id}
            data-id={i.id}
            className="astryn-rail-item cursor-pointer rounded-md border px-2 py-1 text-xs hover:bg-accent"
            onClick={() => onOpen(i.id)}
            title={i.title}
          >
            <span className="text-muted-foreground">{i.identifier}</span> {i.title}
          </div>
        ))}
        {issues.length === 0 && <div className="text-xs text-muted-foreground">Nothing unscheduled.</div>}
      </div>
    </aside>
  );
}
