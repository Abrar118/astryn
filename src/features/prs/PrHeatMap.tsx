import type { PrHeatWeek, PrHeatCell } from "./prActivity";

const WEEKDAY_LABELS = ["", "mon", "", "wed", "", "fri", ""];
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

/** A step of the neutral ramp: foreground mixed into the muted empty-cell colour.
 *  The key is reserved for now, so only today's cell carries it (as a ring). */
function heatColor(opacity: number): string {
  return `color-mix(in oklab, var(--foreground) ${Math.round(opacity * 70)}%, var(--muted))`;
}

/** Cell background scaled to the busiest day. */
function cellBg(count: number, maxCount: number): string | undefined {
  if (count === 0 || maxCount === 0) return undefined;
  const ratio = count / maxCount;
  const opacity = ratio <= 0.2 ? 0.2 : ratio <= 0.4 ? 0.4 : ratio <= 0.6 ? 0.6 : ratio <= 0.8 ? 0.8 : 1;
  return heatColor(opacity);
}

/** A non-interactive GitHub-style contribution grid (contributions per day). */
export function PrHeatMap({ weeks }: { weeks: PrHeatWeek[] }) {
  const maxCount = Math.max(0, ...weeks.flatMap((w) => w.cells.map((c) => c.count)));
  const dated = weeks.flatMap((w) => w.cells).filter((c) => c.date);
  const today = dated[dated.length - 1]?.date;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-stretch gap-[3px]">
        {/* Weekday label column */}
        <div className="flex w-7 shrink-0 flex-col gap-[3px]">
          <span className="h-[14px]" aria-hidden />
          {WEEKDAY_LABELS.map((label, i) => (
            <span
              key={i}
              className="flex flex-1 items-center text-[11px] leading-none text-muted-foreground"
            >
              {label}
            </span>
          ))}
        </div>

        {/* Week columns — flex to fill width, cells stay square */}
        <div className="flex min-w-0 flex-1 gap-[3px]">
          {weeks.map((week, weekIdx) => {
            const firstDate = (cells: PrHeatCell[]) => cells.find((c) => c.date)?.date ?? "";
            const thisMonth = monthOf(firstDate(week.cells));
            const prevMonth = weekIdx === 0 ? null : monthOf(firstDate(weeks[weekIdx - 1]?.cells ?? []));
            const showMonth = thisMonth !== "" && (weekIdx === 0 || thisMonth !== prevMonth);
            return (
              <div key={weekIdx} className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="h-[14px] overflow-visible whitespace-nowrap text-left text-[11px] leading-none text-muted-foreground">
                  {showMonth ? thisMonth : ""}
                </span>
                {week.cells.map((cell: PrHeatCell, dayIdx) => {
                  // Empty padded slot (partial edge week) — purely decorative.
                  if (!cell.date) {
                    return <span key={dayIdx} aria-hidden className="aspect-square w-full rounded-[2px]" />;
                  }
                  const bg = cellBg(cell.count, maxCount);
                  const label = `${cell.count} contribution${cell.count !== 1 ? "s" : ""} · ${formatDate(cell.date)}`;
                  return (
                    <span
                      key={dayIdx}
                      role="img"
                      aria-label={label}
                      title={label}
                      className={[
                        "aspect-square w-full rounded-[2px]",
                        cell.count === 0 ? "bg-muted" : "",
                        cell.date === today ? "prs-heat-today" : "",
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
        <span className="text-[11px] text-muted-foreground">less</span>
        {LEGEND_OPACITIES.map((opacity, i) => (
          <span
            key={i}
            className="h-2.5 w-2.5 rounded-[2px]"
            style={
              opacity === 0
                ? { backgroundColor: "var(--muted)" }
                : { backgroundColor: heatColor(opacity) }
            }
          />
        ))}
        <span className="text-[11px] text-muted-foreground">more</span>
      </div>
    </div>
  );
}
