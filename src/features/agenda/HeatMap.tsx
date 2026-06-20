import type { HeatWeek, HeatCell } from "./agendaStats";

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/** Derive a human-readable weekday name from a YYYY-MM-DD string. */
function weekdayName(date: string): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const d = new Date(`${date}T00:00:00Z`);
  return days[d.getUTCDay()] ?? "Day";
}

/** Format "Mon Jun 21" from a YYYY-MM-DD string. */
function formatDate(date: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Date(`${date}T00:00:00Z`);
  return `${weekdayName(date)} ${months[d.getUTCMonth()] ?? ""} ${d.getUTCDate()}`;
}

/** Compute an indigo-based background color for a given count and maxCount. */
function cellBg(count: number, maxCount: number): string | undefined {
  if (count === 0 || maxCount === 0) return undefined;
  // 5 buckets: 1-20%, 21-40%, 41-60%, 61-80%, 81-100%
  const ratio = count / maxCount;
  const opacity = ratio <= 0.2 ? 0.2 : ratio <= 0.4 ? 0.4 : ratio <= 0.6 ? 0.6 : ratio <= 0.8 ? 0.8 : 1;
  return `rgba(99, 102, 241, ${opacity})`; // indigo-500
}

const LEGEND_OPACITIES = [0, 0.2, 0.45, 0.7, 1];

interface HeatMapProps {
  weeks: HeatWeek[];
  currentOffset: number;
  onSelectWeek: (offset: number) => void;
}

export function HeatMap({ weeks, currentOffset, onSelectWeek }: HeatMapProps) {
  const allCounts = weeks.flatMap((w) => w.cells.map((c) => c.count));
  const maxCount = Math.max(0, ...allCounts);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        {/* Weekday label column */}
        <div className="flex flex-col gap-[3px] pt-[18px]">
          {WEEKDAY_LETTERS.map((letter, i) => (
            <span
              key={i}
              className="flex h-3 w-3 items-center justify-center text-[9px] leading-none text-muted-foreground"
            >
              {letter}
            </span>
          ))}
        </div>

        {/* Week columns */}
        {weeks.map((week, weekIdx) => {
          const isSelected = week.offset === currentOffset;
          const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          const thisMonth = months[new Date(`${week.cells[0]?.date ?? ""}T00:00:00Z`).getUTCMonth()] ?? "";
          const prevMonth = weekIdx === 0 ? null : (months[new Date(`${weeks[weekIdx - 1]?.cells[0]?.date ?? ""}T00:00:00Z`).getUTCMonth()] ?? "");
          const showMonth = weekIdx === 0 || thisMonth !== prevMonth;
          return (
            <div
              key={week.offset}
              className={[
                "flex flex-col gap-[3px] rounded-sm p-[2px] transition-all duration-100",
                isSelected ? "ring-1 ring-ring" : "",
              ].join(" ")}
            >
              {/* Month label — only on first column or when month changes */}
              <span className="h-[14px] text-center text-[9px] leading-none text-muted-foreground">
                {showMonth ? thisMonth : ""}
              </span>
              {week.cells.map((cell: HeatCell, dayIdx) => {
                const bg = cellBg(cell.count, maxCount);
                const label = `${weekdayName(cell.date)} ${formatDate(cell.date).slice(4)}: ${cell.count} issue${cell.count !== 1 ? "s" : ""}`;
                return (
                  <button
                    key={dayIdx}
                    type="button"
                    aria-label={label}
                    title={label}
                    onClick={() => onSelectWeek(cell.offset)}
                    className={[
                      "h-3 w-3 cursor-pointer rounded-[2px] outline-none transition-opacity duration-100",
                      "focus-visible:ring-1 focus-visible:ring-ring",
                      cell.count === 0 ? "bg-muted/40" : "",
                    ].join(" ")}
                    style={bg ? { backgroundColor: bg } : undefined}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1.5 pl-4">
        <span className="text-[10px] text-muted-foreground">Less</span>
        {LEGEND_OPACITIES.map((opacity, i) => (
          <span
            key={i}
            className="h-2.5 w-2.5 rounded-[2px]"
            style={
              opacity === 0
                ? { backgroundColor: "var(--color-muted)", opacity: 0.4 }
                : { backgroundColor: `rgba(99, 102, 241, ${opacity})` }
            }
          />
        ))}
        <span className="text-[10px] text-muted-foreground">More</span>
      </div>
    </div>
  );
}
