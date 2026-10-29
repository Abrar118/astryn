import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Draggable } from "@fullcalendar/interaction";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import type { CalendarIssue } from "@/lib/commands";
import { Button } from "@/components/ui/button";
import { LampMessage } from "@/features/agenda/LampMessage";

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
  const titleId = useId();
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

  // Collapsed: a thin strip on the right with the count and a vertical legend.
  if (collapsed) {
    return (
      <aside
        id="astryn-unscheduled"
        aria-label="Unscheduled"
        className="flex w-11 shrink-0 flex-col items-center border-l border-border pt-2"
      >
        <button
          type="button"
          aria-label={`Expand unscheduled, ${issues.length} task${issues.length === 1 ? "" : "s"}`}
          title="Expand unscheduled"
          onClick={() => setCollapsed(false)}
          className="dash-control flex flex-col items-center gap-3 rounded-md px-1.5 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PanelRightOpen className="size-4" />
          <span className="text-[12px] tabular-nums text-foreground">{issues.length}</span>
          <span className="text-[12px] [writing-mode:vertical-rl]">unscheduled</span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      id="astryn-unscheduled"
      aria-labelledby={titleId}
      ref={ref}
      className="cal-rail flex shrink-0 flex-col border-l border-border"
    >
      <div className="flex items-center justify-between gap-2 py-2 pr-2 pl-4">
        <h2 id={titleId} className="text-[13px] font-semibold tracking-tight text-foreground">
          Unscheduled
          <span className="ml-2 font-normal tabular-nums text-muted-foreground">{issues.length}</span>
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Collapse unscheduled"
          title="Collapse unscheduled"
          onClick={() => setCollapsed(true)}
          className="text-muted-foreground"
        >
          <PanelRightClose />
        </Button>
      </div>

      {issues.length === 0 ? (
        <LampMessage
          tone="off"
          title="Nothing unscheduled"
          body="Every task in this view has a due date."
          className="border-t border-border py-4"
        />
      ) : (
        <>
          <p className="border-b border-border px-4 pb-2 text-[12px] text-muted-foreground">
            Drag a task onto a day to schedule it.
          </p>
          <ul className="cal-rail-list drawer-scrollbar min-h-0 flex-1 overflow-y-auto pb-20">
            {issues.map((i) => (
              <li key={i.id}>
                <div
                  data-id={i.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${i.identifier}: ${i.title}`}
                  onClick={() => onOpen(i.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(i.id);
                    }
                  }}
                  onContextMenu={(e) => onContextMenu(e, i.id)}
                  title={i.title}
                  className="astryn-rail-item dash-control cal-rail-row"
                >
                  <span
                    aria-hidden
                    className="dash-lamp dash-lamp-lit mt-[5px]"
                    style={{ backgroundColor: i.stateColor || "var(--muted-foreground)" }}
                  />
                  <span className="min-w-0">
                    <span className="block font-mono text-[12px] text-muted-foreground">{i.identifier}</span>
                    <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-foreground">{i.title}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
