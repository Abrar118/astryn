import type { GithubPr } from "@/lib/commands";
import { addDays, weekWindow } from "@/lib/dates";

export type PrHeatCell = { date: string; count: number };
/** 7 cells in Sun→Sat order. */
export type PrHeatWeek = { cells: PrHeatCell[] };

/** Distinct PRs by id (a PR can appear in several buckets). */
function uniqueById(prs: GithubPr[]): GithubPr[] {
  const map = new Map<string, GithubPr>();
  for (const pr of prs) if (!map.has(pr.id)) map.set(pr.id, pr);
  return [...map.values()];
}

/**
 * A GitHub-style contribution grid of PR activity: distinct PRs counted on the
 * day they were last updated, across the trailing `weeksBack` Sunday-started
 * weeks (oldest→newest), anchored to the Asia/Dhaka calendar like the rest of
 * the app.
 */
export function buildPrHeatmap(
  prs: GithubPr[],
  opts: { now: Date; weeksBack: number },
): PrHeatWeek[] {
  const countByDate = new Map<string, number>();
  for (const pr of uniqueById(prs)) {
    if (!pr.updatedAt) continue;
    const date = pr.updatedAt.slice(0, 10);
    countByDate.set(date, (countByDate.get(date) ?? 0) + 1);
  }

  const weeks: PrHeatWeek[] = [];
  for (let offset = -opts.weeksBack; offset <= 0; offset++) {
    const { weekStart } = weekWindow(opts.now, offset);
    const cells: PrHeatCell[] = [];
    for (let day = 0; day < 7; day++) {
      const date = addDays(weekStart, day);
      cells.push({ date, count: countByDate.get(date) ?? 0 });
    }
    weeks.push({ cells });
  }
  return weeks;
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
