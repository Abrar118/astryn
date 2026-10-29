import { ChevronRight } from "lucide-react";
import type { GithubPr } from "@/lib/commands";

/** Targeting the repo's default branch (main/master) is emphasized. */
function isDefaultBranch(base: string | null): boolean {
  const b = base?.toLowerCase();
  return b === "main" || b === "master";
}

/**
 * A compact, monochrome git-graph glyph: the head branch forks off the base
 * lane (left), carries the PR commit, then curves back toward an open merge
 * node on the base lane (right, dashed = not yet merged). Health is the row
 * lamp's job, so the glyph only shows direction; a draft's commit is hollow.
 */
function Glyph({ draft }: { draft: boolean }) {
  return (
    <svg
      width="46"
      height="22"
      viewBox="0 0 46 22"
      fill="none"
      aria-hidden
      className="shrink-0 text-muted-foreground"
    >
      <line x1="3" y1="6" x2="43" y2="6" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="11" cy="6" r="2" fill="currentColor" fillOpacity="0.6" />
      <path d="M11 6 C 11 12, 13 17, 19 17 L 30 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M30 17 C 36 17, 39 12, 39 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2.5" strokeOpacity="0.7" />
      <circle cx="24.5" cy="17" r="3" fill={draft ? "var(--card)" : "currentColor"} stroke="currentColor" strokeWidth="1.5" />
      <circle cx="39" cy="6" r="2" fill="var(--card)" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.5" />
    </svg>
  );
}

/** head → base branch visualization for a PR row. Renders nothing without a head branch. */
export function BranchGraph({ pr }: { pr: GithubPr }) {
  if (!pr.branch) return null;
  const onDefault = isDefaultBranch(pr.baseBranch);
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={pr.baseBranch ? `${pr.branch} → ${pr.baseBranch}` : pr.branch}>
      <Glyph draft={pr.draft} />
      <span className="max-w-[200px] truncate font-mono text-[12px] text-foreground">{pr.branch}</span>
      {pr.baseBranch && (
        <>
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className={`max-w-[150px] truncate font-mono text-[12px] ${onDefault ? "text-foreground" : "text-muted-foreground"}`}>
            {pr.baseBranch}
          </span>
        </>
      )}
    </span>
  );
}
