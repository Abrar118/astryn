import type { PriorityBreakdownEntry } from "./agendaStats";

interface PriorityBarProps {
  data: PriorityBreakdownEntry[];
}

export function PriorityBar({ data }: PriorityBarProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
        No issues this week
      </div>
    );
  }

  const maxCount = Math.max(...data.map((e) => e.count));

  return (
    <ul className="flex flex-col gap-2" role="list">
      {data.map((entry) => {
        const widthPct = maxCount > 0 ? (entry.count / maxCount) * 100 : 0;
        return (
          <li key={entry.priority} className="flex items-center gap-2 text-xs">
            {/* Label */}
            <span className="w-16 shrink-0 text-muted-foreground">{entry.label}</span>

            {/* Bar track */}
            <div className="relative flex-1 overflow-hidden rounded-full bg-muted/30" style={{ height: 6 }}>
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-100"
                style={{ width: `${widthPct}%`, backgroundColor: entry.color }}
              />
            </div>

            {/* Count */}
            <span className="w-5 shrink-0 text-right tabular-nums text-foreground">{entry.count}</span>
          </li>
        );
      })}
    </ul>
  );
}
