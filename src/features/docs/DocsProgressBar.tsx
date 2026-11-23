import type { DocsProgress } from "./useDocsProgress";

/** What the bar says for each phase of indexing. */
export function progressLabel(p: DocsProgress): string {
  const what = p.phase === "reading" ? "Reading files" : "Preparing meaning-based search";
  if (p.total === 0) return `${what}…`;
  const unit = p.phase === "reading" ? "files" : "sections";
  return `${what}: ${p.done} of ${p.total} ${unit} · ${Math.round((p.done / p.total) * 100)}%`;
}

/** Progress bar for indexing; an empty track with a label while the total is unknown. */
export function DocsProgressBar({ progress }: { progress: DocsProgress | null }) {
  if (!progress) return null;
  const known = progress.total > 0;
  const pct = known ? Math.min(100, (progress.done / progress.total) * 100) : 0;
  const label = progressLabel(progress);
  return (
    <div className="flex flex-col gap-1">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? Math.round(pct) : undefined}
        className="h-1 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-muted-foreground transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[12px] tabular-nums text-muted-foreground">{label}</p>
    </div>
  );
}
