import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Draggable } from "@fullcalendar/interaction";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import type { CalendarIssue } from "@/lib/commands";

const COLLAPSE_KEY = "astryn.unscheduled.collapsed";

export function UnscheduledRail({
  issues,
  onOpen,
  onContextMenu,
  onCollapseChange,
}: {
  issues: CalendarIssue[];
  onOpen: (id: string) => void;
  onContextMenu: (e: ReactMouseEvent, id: string) => void;
  /** Fired after the collapsed state changes so the calendar can re-measure. */
  onCollapseChange?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // Storage unavailable — keep the in-memory state.
    }
    onCollapseChange?.();
  }, [collapsed, onCollapseChange]);

  useEffect(() => {
    // Re-init when expanding: the draggable container only exists while expanded.
    if (collapsed || !ref.current) return;
    // create:false => FullCalendar adds no internal event on drop; our cache drives
    // rendering. The calendar's `drop` callback still fires with the target date.
    const d = new Draggable(ref.current, {
      itemSelector: ".astryn-rail-item",
      eventData: () => ({ create: false }),
    });
    return () => d.destroy();
  }, [collapsed]);

  // Collapsed: a thin strip pinned to the right with a vertical label + expand button.
  if (collapsed) {
    return (
      <aside
        id="astryn-unscheduled"
        className="flex w-10 shrink-0 flex-col items-center gap-3 border-l border-border py-3"
      >
        <button
          type="button"
          aria-label="Expand unscheduled"
          title="Expand unscheduled"
          onClick={() => setCollapsed(false)}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PanelRightOpen className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Expand unscheduled"
          className="flex flex-1 cursor-pointer flex-col items-center gap-2"
        >
          <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            {issues.length}
          </span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground [writing-mode:vertical-rl]">
            Unscheduled
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      id="astryn-unscheduled"
      ref={ref}
      className="flex w-64 shrink-0 flex-col border-l border-border"
    >
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Unscheduled
          </span>
          <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            {issues.length}
          </span>
        </div>
        <button
          type="button"
          aria-label="Collapse unscheduled"
          title="Collapse unscheduled"
          onClick={() => setCollapsed(true)}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PanelRightClose className="size-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-20">
        {issues.map((i) => (
          <div
            key={i.id}
            data-id={i.id}
            onClick={() => onOpen(i.id)}
            onContextMenu={(e) => onContextMenu(e, i.id)}
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
