import type { PrDiffRow } from "./prDiffDisplay";

export type PrFileStat = {
  path: string;
  additions: number;
  deletions: number;
};

/** Additions and deletions in one parsed patch. */
export function countChanges(rows: PrDiffRow[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const row of rows) {
    if (row.kind === "addition") additions += 1;
    if (row.kind === "deletion") deletions += 1;
  }
  return { additions, deletions };
}

/** Files ordered by total churn, ties broken by path so the list is stable. */
export function rankByChurn(stats: PrFileStat[]): PrFileStat[] {
  return [...stats].sort(
    (a, b) =>
      b.additions +
        b.deletions -
        (a.additions + a.deletions) || a.path.localeCompare(b.path),
  );
}

/** Compact `+12 -3` summary for a row badge. */
export function churnLabel(stat: PrFileStat): string {
  if (!stat.additions && !stat.deletions) return "no changes";
  const parts: string[] = [];
  if (stat.additions) parts.push(`+${stat.additions}`);
  if (stat.deletions) parts.push(`-${stat.deletions}`);
  return parts.join(" ");
}

/** Rolled-up totals across every file in the pull request. */
export function totalChurn(stats: PrFileStat[]): PrFileStat {
  return stats.reduce(
    (total, stat) => ({
      path: total.path,
      additions: total.additions + stat.additions,
      deletions: total.deletions + stat.deletions,
    }),
    { path: `${stats.length} files`, additions: 0, deletions: 0 },
  );
}
