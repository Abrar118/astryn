import { ChevronRight } from "lucide-react";
import type { GithubPr } from "@/lib/commands";

/**
 * Accent color for the head lane + PR node, derived from PR health.
 * Mirrors the row's badge palette so the graph reads at a glance.
 */
function accentFor(pr: GithubPr): string {
  if (pr.draft) return "#9ca3af"; // gray-400 — not ready
  if (pr.mergeable === "conflicting") return "#fbbf24"; // amber-400
  if (pr.ciStatus === "failure") return "#f87171"; // red-400
  if (pr.ciStatus === "pending") return "#fbbf24"; // amber-400
  return "#34d399"; // emerald-400 — healthy / open
}

/**
 * A compact git-graph glyph: the head branch forks off the base lane (left),
 * carries the PR commit, then curves back toward an open merge node on the
 * base lane (right, dashed = not yet merged). Conveys head → base direction.
 */
function Glyph({ accent, draft }: { accent: string; draft: boolean }) {
  return (
    <svg
      width="46"
      height="22"
      viewBox="0 0 46 22"
      fill="none"
      aria-hidden
      className="shrink-0 text-muted-foreground"
    >
      {/* base lane (target branch) */}
      <line x1="3" y1="6" x2="43" y2="6" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" strokeLinecap="round" />
      {/* fork point on the base lane */}
      <circle cx="11" cy="6" r="2" fill="currentColor" fillOpacity="0.55" />
      {/* head branch: fork down, run, then merge curve back up */}
      <path d="M11 6 C 11 12, 13 17, 19 17 L 30 17" stroke={accent} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M30 17 C 36 17, 39 12, 39 6" stroke={accent} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2.5" strokeOpacity="0.7" />
      {/* PR commit node on the head lane */}
      <circle cx="24.5" cy="17" r="3" fill={draft ? "var(--color-card)" : accent} stroke={accent} strokeWidth="1.5" />
      {/* open merge node on the base lane */}
      <circle cx="39" cy="6" r="2" fill="var(--color-card)" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.5" />
    </svg>
  );
}

/** head → base branch visualization for a PR row. Renders nothing without a head branch. */
export function BranchGraph({ pr }: { pr: GithubPr }) {
  if (!pr.branch) return null;
  const accent = accentFor(pr);
  return (
    <span className="flex min-w-0 items-center gap-1 text-[11px]" title={pr.baseBranch ? `${pr.branch} → ${pr.baseBranch}` : pr.branch}>
      <Glyph accent={accent} draft={pr.draft} />
      <span className="max-w-[150px] truncate font-medium text-foreground/85">{pr.branch}</span>
      {pr.baseBranch && (
        <>
          <ChevronRight className="size-3 shrink-0 text-muted-foreground/70" />
          <span className="max-w-[110px] truncate text-muted-foreground">{pr.baseBranch}</span>
        </>
      )}
    </span>
  );
}
