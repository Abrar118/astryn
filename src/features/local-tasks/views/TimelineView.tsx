import { statusHue } from "@/lib/statusHue";
import { useEffect, useRef } from "react";
import { addDays, isOverdue } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { StatusIcon } from "@/features/drawer/issueGlyphs";
import { barFor, clipBar, daysBetween, timelineRange } from "../localTaskModel";
import type { ViewProps } from "./ListView";

const DAY = 28;
const LABEL = 260;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function shortDate(d: string): string {
  return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
}

/** Gantt-style timeline: a bar from start to due date per task, whole weeks, the needle at today. */
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
    <div className="flex h-full flex-col overflow-hidden pb-24">
      <div ref={scroller} className="drawer-scrollbar min-h-0 flex-1 overflow-auto">
        <div className="relative flex min-h-full flex-col" style={{ width: LABEL + days * DAY }}>
          <div className="sticky top-0 z-20 flex border-b border-border bg-background">
            <div
              className="sticky left-0 z-10 flex shrink-0 items-end bg-background px-3 pb-1.5 text-[12px] font-medium text-muted-foreground"
              style={{ width: LABEL }}
            >
              task
            </div>
            {weeks.map((w) => (
              <div key={w} className="shrink-0 border-l border-border" style={{ width: DAY * 7 }}>
                <div className="px-2 pt-2 text-[12px] font-medium text-foreground">{shortDate(w)}</div>
                <div className="flex">
                  {Array.from({ length: 7 }, (_, d) => {
                    const day = addDays(w, d);
                    return (
                      <div
                        key={day}
                        aria-current={day === props.today ? "date" : undefined}
                        className={cn(
                          "py-1 text-center text-[12px] tabular-nums",
                          day === props.today ? "font-semibold text-foreground" : "text-muted-foreground",
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

          <div className="relative flex-1">
            {todayOffset >= 0 && todayOffset < days && (
              <span aria-hidden className="lt-needle z-[5]" style={{ left: LABEL + todayOffset * DAY + DAY / 2 }} />
            )}

            {dated.length === 0 && (
              <p className="sticky left-0 px-3 py-6 text-[13px] text-muted-foreground" style={{ width: 480 }}>
                Give tasks a start or due date to see them here.
              </p>
            )}
            {dated.map((t) => {
              const raw = barFor(t, start);
              const bar = raw && clipBar(raw, days);
              const overdue = isOverdue(t.dueDate, t.stateType, props.today);
              return (
                <div key={t.id} className="group relative flex h-9 items-center border-b border-border/70 hover:bg-accent">
                  <button
                    type="button"
                    onClick={() => props.onOpen(t.id)}
                    onContextMenu={(e) => props.onMenu(e, t.id)}
                    className="lt-focus sticky left-0 z-10 flex h-full shrink-0 cursor-pointer items-center gap-2 border-r border-border bg-background px-3 text-left group-hover:bg-accent"
                    style={{ width: LABEL }}
                  >
                    <StatusIcon type={t.stateType} color={t.stateColor} />
                    <span className="shrink-0 whitespace-nowrap font-mono text-[12px] text-muted-foreground">{t.identifier}</span>
                    <span className="truncate text-[13px] text-foreground">{t.title}</span>
                  </button>
                  {bar && (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-hidden
                      onClick={() => props.onOpen(t.id)}
                      onContextMenu={(e) => props.onMenu(e, t.id)}
                      title={`${t.identifier} · ${t.startDate ? shortDate(t.startDate) : "—"} → ${t.dueDate ? shortDate(t.dueDate) : "—"}`}
                      className="lt-bar absolute top-1.5 flex h-6 cursor-pointer items-center gap-1.5 overflow-hidden px-2 text-[12px] font-medium"
                      style={{
                        left: LABEL + bar.offset * DAY + 2,
                        width: Math.max(bar.span * DAY - 4, DAY - 4),
                      }}
                    >
                      <span className="dash-lamp dash-lamp-lit size-1.5" style={{ backgroundColor: statusHue(t.stateColor) || "var(--muted-foreground)" }} />
                      <span className={cn("truncate", overdue ? "text-destructive" : "text-foreground")}>{bar.span > 2 ? t.title : ""}</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {undated.length > 0 && (
        <details className="shrink-0 border-t border-border px-3 py-2">
          <summary className="lt-focus cursor-pointer rounded-sm text-[13px] text-muted-foreground hover:text-foreground">
            {undated.length} task{undated.length === 1 ? "" : "s"} without dates
          </summary>
          <ul className="mt-1 max-h-40 overflow-y-auto">
            {undated.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => props.onOpen(t.id)}
                  className="lt-focus flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-1.5 text-left text-[13px] hover:bg-accent"
                >
                  <StatusIcon type={t.stateType} color={t.stateColor} />
                  <span className="shrink-0 font-mono text-[12px] text-muted-foreground">{t.identifier}</span>
                  <span className="truncate text-foreground">{t.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
