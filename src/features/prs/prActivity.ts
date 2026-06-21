import type { Contributions, GithubPr } from "@/lib/commands";

export type PrHeatCell = { date: string; count: number };
/** 7 cells in Sun→Sat order (empty padded slots have an empty date). */
export type PrHeatWeek = { cells: PrHeatCell[] };

/**
 * Map the GitHub contribution calendar to fixed 7-row week columns, placing each
 * day at its weekday so partial edge weeks stay aligned (missing slots render
 * empty). Weeks stay in GitHub's oldest→newest order.
 */
export function contributionsToWeeks(contributions: Contributions | null | undefined): PrHeatWeek[] {
  if (!contributions) return [];
  return contributions.weeks.map((week) => {
    const cells: PrHeatCell[] = Array.from({ length: 7 }, () => ({ date: "", count: 0 }));
    for (const day of week) {
      const i = day.weekday >= 0 && day.weekday <= 6 ? day.weekday : 0;
      cells[i] = { date: day.date, count: day.count };
    }
    return { cells };
  });
}

/** Distinct PRs by id (a PR can appear in several buckets). */
function uniqueById(prs: GithubPr[]): GithubPr[] {
  const map = new Map<string, GithubPr>();
  for (const pr of prs) if (!map.has(pr.id)) map.set(pr.id, pr);
  return [...map.values()];
}

export type PrStats = {
  /** Distinct open PRs across all buckets. */
  open: number;
  /** PRs awaiting your review. */
  needsReview: number;
  /** Your own PRs that have changes requested. */
  changesRequested: number;
  /** Distinct PRs with merge conflicts. */
  conflicts: number;
};

/** Headline counts for the activity card's metric tiles. */
export function prStats(prs: GithubPr[]): PrStats {
  const unique = uniqueById(prs);
  return {
    open: unique.length,
    needsReview: prs.filter((p) => p.bucket === "needs_review").length,
    changesRequested: prs.filter(
      (p) => p.bucket === "mine" && p.reviewDecision === "changes_requested",
    ).length,
    conflicts: unique.filter((p) => p.mergeable === "conflicting").length,
  };
}
