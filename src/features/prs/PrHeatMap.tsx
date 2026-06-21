import type { PrHeatWeek, PrHeatCell } from "./prActivity";

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LEGEND_OPACITIES = [0, 0.2, 0.45, 0.7, 1];

function monthOf(date: string): string {
  return MONTHS[new Date(`${date}T00:00:00Z`).getUTCMonth()] ?? "";
}

/** "Mon Jun 21" from a YYYY-MM-DD string. */
function formatDate(date: string): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const d = new Date(`${date}T00:00:00Z`);
  return `${days[d.getUTCDay()] ?? ""} ${monthOf(date)} ${d.getUTCDate()}`;
}

/** Indigo cell background scaled to the busiest day, matching the Overview heatmap. */
function cellBg(count: number, maxCount: number): string | undefined {
  if (count === 0 || maxCount === 0) return undefined;
  const ratio = count / maxCount;
  const opacity = ratio <= 0.2 ? 0.2 : ratio <= 0.4 ? 0.4 : ratio <= 0.6 ? 0.6 : ratio <= 0.8 ? 0.8 : 1;
  return `rgba(99, 102, 241, ${opacity})`;
}

/** A non-interactive contribution grid of PR activity (PRs updated per day). */
export function PrHeatMap({ weeks }: { weeks: PrHeatWeek[] }) {
  const maxCount = Math.max(0, ...weeks.flatMap((w) => w.cells.map((c) => c.count)));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-stretch gap-[3px]">
        {/* Weekday label column */}
        <div className="flex w-3 shrink-0 flex-col gap-[3px]">
          <span className="h-[14px]" aria-hidden />
          {WEEKDAY_LETTERS.map((letter, i) => (
            <span
              key={i}
              className="flex flex-1 items-center justify-center text-[9px] leading-none text-muted-foreground"
            >
              {letter}
            </span>
          ))}
        </div>

        {/* Week columns — flex to fill width, cells stay square */}
        <div className="flex min-w-0 flex-1 gap-[3px]">
          {weeks.map((week, weekIdx) => {
            const thisMonth = monthOf(week.cells[0]?.date ?? "");
            const prevMonth = weekIdx === 0 ? null : monthOf(weeks[weekIdx - 1]?.cells[0]?.date ?? "");
            const showMonth = weekIdx === 0 || thisMonth !== prevMonth;
            return (
              <div key={weekIdx} className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="h-[14px] truncate text-center text-[9px] leading-none text-muted-foreground">
                  {showMonth ? thisMonth : ""}
                </span>
                {week.cells.map((cell: PrHeatCell, dayIdx) => {
                  const bg = cellBg(cell.count, maxCount);
                  const label = `${cell.count} PR${cell.count !== 1 ? "s" : ""} updated · ${formatDate(cell.date)}`;
                  return (
                    <span
                      key={dayIdx}
                      role="img"
                      aria-label={label}
                      title={label}
                      className={[
                        "aspect-square w-full rounded-[2px]",
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
