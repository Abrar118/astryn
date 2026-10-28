import { useEffect, useRef } from "react";
import { addDays } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { StatusIcon } from "@/features/drawer/issueGlyphs";
import { tint } from "@/features/calendar/eventStyle";
import { barFor, daysBetween, timelineRange } from "../localTaskModel";
import type { ViewProps } from "./ListView";

const DAY = 28;
const LABEL = 260;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(d: string): string {
  return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
}

/** Gantt-style timeline: a bar from start to due date per task, whole weeks, today marked. */
export function TimelineView(props: ViewProps) {
  const dated = props.tasks
    .filter((t) => t.startDate || t.dueDate)
    .sort((a, b) => (a.startDate ?? a.dueDate ?? "").localeCompare(b.startDate ?? b.dueDate ?? ""));
  const undated = props.tasks.filter((t) => !t.startDate && !t.dueDate);
  const { start, days } = timelineRange(dated, props.today);
  const weeks = Array.from({ length: days / 7 }, (_, w) => addDays(start, w * 7));
  const todayOffset = daysBetween(start, props.today);
  const scroller = useRef<HTMLDivElement>(null);

  // Open on today rather than at the range's first week.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, (todayOffset - 7) * DAY);
  }, [todayOffset]);

  return (
    <div className="flex h-full flex-col overflow-hidden pb-20">
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <div className="relative" style={{ width: LABEL + days * DAY }}>
          <div className="sticky top-0 z-20 flex border-b border-border bg-background">
            <div className="sticky left-0 z-10 shrink-0 bg-background px-3 py-2 text-[11px] font-medium text-muted-foreground" style={{ width: LABEL }}>
              Task
            </div>
            {weeks.map((w) => (
              <div key={w} className="shrink-0 border-l border-border/60" style={{ width: DAY * 7 }}>
                <div className="px-2 pt-1.5 text-[11px] font-medium text-foreground">{shortDate(w)}</div>
                <div className="flex">
                  {Array.from({ length: 7 }, (_, d) => {
                    const day = addDays(w, d);
                    return (
                      <div
                        key={day}
                        className={cn(
                          "py-1 text-center text-[11px] tabular-nums",
                          day === props.today ? "font-semibold text-primary" : "text-muted-foreground",
                        )}
                        style={{ width: DAY }}
                      >
                        {Number(day.slice(8, 10))}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {todayOffset >= 0 && todayOffset < days && (
            <div
              aria-hidden
              className="pointer-events-none absolute bottom-0 top-0 z-0 w-px bg-primary/60"
              style={{ left: LABEL + todayOffset * DAY + DAY / 2 }}
            />
          )}

          {dated.length === 0 && (
            <p className="sticky left-0 px-3 py-6 text-sm text-muted-foreground" style={{ width: 480 }}>
              Give tasks a start or due date to see them here.
            </p>
          )}
          {dated.map((t) => {
            const bar = barFor(t, start);
            if (!bar) return null;
            const color = t.stateColor || "var(--muted-foreground)";
            return (
              <div key={t.id} className="group relative flex h-9 items-center border-b border-border/30 hover:bg-accent/40">
                <button
                  type="button"
                  onClick={() => props.onOpen(t.id)}
                  onContextMenu={(e) => props.onMenu(e, t.id)}
                  className="sticky left-0 z-10 flex h-full shrink-0 cursor-pointer items-center gap-2 bg-background px-3 text-left group-hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  style={{ width: LABEL }}
                >
                  <StatusIcon type={t.stateType} color={t.stateColor} />
                  <span className="font-mono text-[11px] text-muted-foreground">{t.identifier}</span>
                  <span className="truncate text-[13px] text-foreground">{t.title}</span>
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden
                  onClick={() => props.onOpen(t.id)}
                  onContextMenu={(e) => props.onMenu(e, t.id)}
                  title={`${t.identifier} · ${t.startDate ? shortDate(t.startDate) : "—"} → ${t.dueDate ? shortDate(t.dueDate) : "—"}`}
                  className="absolute top-1.5 flex h-6 cursor-pointer items-center overflow-hidden rounded-md border px-2 text-[11px] font-medium text-foreground"
                  style={{
                    left: LABEL + bar.offset * DAY + 2,
                    width: Math.max(bar.span * DAY - 4, DAY - 4),
                    backgroundColor: tint(color, 0.22),
                    borderColor: tint(color, 0.55),
                  }}
                >
                  <span className="truncate">{bar.span > 2 ? t.title : ""}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {undated.length > 0 && (
        <details className="shrink-0 border-t border-border px-3 py-2">
          <summary className="cursor-pointer text-[13px] text-muted-foreground">
            {undated.length} task{undated.length === 1 ? "" : "s"} without dates
          </summary>
          <ul className="mt-1 max-h-40 overflow-y-auto">
            {undated.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => props.onOpen(t.id)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-1 text-left text-[13px] hover:bg-accent"
                >
                  <StatusIcon type={t.stateType} color={t.stateColor} />
                  <span className="font-mono text-[11px] text-muted-foreground">{t.identifier}</span>
                  <span className="truncate">{t.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
