import { IndicatorLamp } from "@/components/IndicatorLamp";
import type { DocHit } from "@/lib/commands";

/** Search hits for the docs sidebar: one row per file, showing its best section. */
export function DocSearchResults({
  hits,
  pending,
  selectedPath,
  onSelect,
}: {
  hits: DocHit[] | undefined;
  pending: boolean;
  selectedPath: string | null;
  onSelect: (hit: DocHit) => void;
}) {
  if (!hits || hits.length === 0) {
    return (
      <p role="status" className="flex items-start gap-2.5 px-4 py-3 text-[13px] text-muted-foreground">
        <IndicatorLamp tone="off" className="mt-1.5" />
        {pending ? "Searching…" : "No matches."}
      </p>
    );
  }
  return (
    <ul aria-label="Search results" className="flex flex-col px-1.5">
      {hits.map((h) => (
        <li key={`${h.sourceId}:${h.path}`}>
          <button
            type="button"
            onClick={() => onSelect(h)}
            aria-current={h.path === selectedPath ? "true" : undefined}
            className={`flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-accent ${
              h.path === selectedPath ? "bg-accent" : ""
            }`}
          >
            <span className="truncate text-[13px] text-foreground">{h.title}</span>
            {h.headingPath && (
              <span className="truncate text-[12px] text-muted-foreground">{h.headingPath}</span>
            )}
            <span className="line-clamp-2 text-[12px] text-muted-foreground">{h.snippet}</span>
            {h.more > 0 && (
              <span className="text-[12px] tabular-nums text-muted-foreground">
                +{h.more} more section{h.more === 1 ? "" : "s"}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
