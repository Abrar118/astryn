import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { HeatWeek, HeatCell } from "./agendaStats";

/** Weekday legends for the rows (Sunday first); only every other row is labelled. */
const WEEKDAY_LEGENDS = ["", "mon", "", "wed", "", "fri", ""];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Format "Mon Jun 21" from a YYYY-MM-DD string. */
function formatDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()] ?? "Day"} ${MONTHS[d.getUTCMonth()] ?? ""} ${d.getUTCDate()}`;
}

function monthOf(week: HeatWeek | undefined): number {
  return new Date(`${week?.cells[0]?.date ?? ""}T00:00:00Z`).getUTCMonth();
}

/** A heat step: a single neutral ramp from the empty-cell tone up toward the foreground. */
function heatColor(strength: number): string {
  return `color-mix(in oklab, var(--foreground) ${Math.round(strength * 100)}%, var(--muted))`;
}

/** Five steps by share of the busiest day: 1–20%, 21–40%, 41–60%, 61–80%, 81–100%. */
function cellBg(count: number, maxCount: number): string | undefined {
  if (count === 0 || maxCount === 0) return undefined;
  const ratio = count / maxCount;
  const step = ratio <= 0.2 ? 0.2 : ratio <= 0.4 ? 0.36 : ratio <= 0.6 ? 0.52 : ratio <= 0.8 ? 0.68 : 0.84;
  return heatColor(step);
}

const LEGEND_STEPS = [0, 0.2, 0.36, 0.52, 0.68, 0.84];

interface HeatMapProps {
  weeks: HeatWeek[];
  currentOffset: number;
  onSelectWeek: (offset: number) => void;
  /** Id of the heading that names the map. */
  labelledBy?: string;
}

/**
 * A year of due dates, one column per week. Each week column is one button;
 * only the selected week sits in the tab order, and ← / → (the screen's week
 * keys) move the selection, so focus follows it here.
 */
export function HeatMap({ weeks, currentOffset, onSelectWeek, labelledBy }: HeatMapProps) {
  const allCounts = weeks.flatMap((w) => w.cells.map((c) => c.count));
  const maxCount = Math.max(0, ...allCounts);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (rootRef.current?.contains(document.activeElement)) selectedRef.current?.focus();
  }, [currentOffset]);

  return (
    <div ref={rootRef} className="flex max-w-[960px] flex-col gap-2.5">
      <div className="flex items-stretch gap-1.5">
        {/* Weekday legends: flex rows align to the square cells beside them */}
        <div aria-hidden className="flex w-7 shrink-0 flex-col gap-[3px]">
          <span className="h-4" />
          {WEEKDAY_LEGENDS.map((legend, i) => (
            <span key={i} className="flex min-h-0 flex-1 items-center text-[11px] leading-none text-muted-foreground">
              {legend}
            </span>
          ))}
        </div>

        <div role="group" aria-labelledby={labelledBy} className="flex min-w-0 flex-1 gap-[3px]">
          {weeks.map((week, weekIdx) => {
            const isSelected = week.offset === currentOffset;
            const month = monthOf(week);
            const showMonth = weekIdx > 0 && month !== monthOf(weeks[weekIdx - 1]) && weekIdx < weeks.length - 2;
            const due = week.cells.reduce((n, c) => n + c.count, 0);
            const first = week.cells[0]?.date ?? "";
            return (
              <button
                key={week.offset}
                ref={isSelected ? selectedRef : undefined}
                type="button"
                tabIndex={isSelected ? 0 : -1}
                aria-pressed={isSelected}
                aria-label={`Week of ${formatDate(first).slice(4)}: ${due} due`}
                onClick={() => onSelectWeek(week.offset)}
                className="heat-week group flex min-w-0 flex-1 cursor-pointer flex-col gap-[3px] rounded-[3px] outline-none"
              >
                {/* Month legend where a month begins; it may run past its narrow column */}
                <span aria-hidden className="h-4 overflow-visible whitespace-nowrap text-left text-[11px] leading-none text-muted-foreground">
                  {showMonth ? MONTHS[month] : ""}
                </span>
                {week.cells.map((cell: HeatCell, dayIdx) => {
                  const bg = cellBg(cell.count, maxCount);
                  return (
                    <span
                      key={dayIdx}
                      title={`${formatDate(cell.date)}: ${cell.count} due`}
                      className={cn("heat-cell aspect-square w-full rounded-[2px]", cell.count === 0 && "bg-muted")}
                      style={bg ? { backgroundColor: bg } : undefined}
                    />
                  );
                })}
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div aria-hidden className="flex items-center gap-1.5 pl-[34px]">
        <span className="mr-0.5 text-[11px] text-muted-foreground">less</span>
        {LEGEND_STEPS.map((step) => (
          <span
            key={step}
            className="size-2.5 rounded-[2px]"
            style={{ backgroundColor: step === 0 ? "var(--muted)" : heatColor(step) }}
          />
        ))}
        <span className="ml-0.5 text-[11px] text-muted-foreground">more</span>
      </div>
    </div>
  );
}
