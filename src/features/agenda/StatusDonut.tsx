import type { StatusBreakdownEntry } from "./agendaStats";

const RADIUS = 42;
const STROKE = 10;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SIZE = 120;
const CENTER = SIZE / 2;

interface StatusDonutProps {
  data: StatusBreakdownEntry[];
}

export function StatusDonut({ data }: StatusDonutProps) {
  const total = data.reduce((s, e) => s + e.count, 0);

  if (total === 0 || data.length === 0) {
    return (
      <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
        No issues this week
      </div>
    );
  }

  // Build aria summary
  const summary = `Status breakdown: ${data.map((e) => `${e.count} ${e.name}`).join(", ")}`;

  // Compute arc segments
  let cumulativeFraction = 0;
  const segments = data.map((entry) => {
    const fraction = entry.count / total;
    const dashArray = fraction * CIRCUMFERENCE;
    const dashOffset = CIRCUMFERENCE * (1 - cumulativeFraction);
    cumulativeFraction += fraction;
    return { ...entry, dashArray, dashOffset };
  });

  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* Donut SVG */}
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-label={summary}
        role="img"
        className="shrink-0"
      >
        {/* Background track */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          className="text-muted/30"
        />
        {segments.map((seg, i) => (
          <circle
            key={i}
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={seg.color}
            strokeWidth={STROKE}
            strokeDasharray={`${seg.dashArray} ${CIRCUMFERENCE}`}
            strokeDashoffset={seg.dashOffset}
            strokeLinecap="butt"
            style={{ transform: "rotate(-90deg)", transformOrigin: "center", transition: "stroke-dasharray 100ms ease" }}
          />
        ))}
        {/* Center label */}
        <text
          x={CENTER}
          y={CENTER - 6}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-foreground font-semibold"
          style={{ fontSize: 18, fontFamily: "Geist, sans-serif" }}
        >
          {total}
        </text>
        <text
          x={CENTER}
          y={CENTER + 10}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: 10, fontFamily: "Geist, sans-serif", fill: "var(--color-muted-foreground)" }}
        >
          issues
        </text>
      </svg>

      {/* Legend */}
      <ul className="flex flex-col gap-1" role="list">
        {data.map((entry) => (
          <li key={entry.type} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto pl-2 tabular-nums text-foreground">{entry.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
