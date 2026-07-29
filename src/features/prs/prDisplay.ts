import type { GithubPr, PrReviewer } from "@/lib/commands";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const WARN_AFTER_DAYS = 2;
const STALE_AFTER_DAYS = 5;
const DIFF_BLOCKS = 5;

/** Distribute additions/deletions across `n` blocks for a GitHub-style diff bar. */
export function diffBlocks(
  additions: number | null,
  deletions: number | null,
  n = DIFF_BLOCKS,
): ("add" | "del" | "none")[] {
  const add = Math.max(0, additions ?? 0);
  const del = Math.max(0, deletions ?? 0);
  const total = add + del;
  if (total === 0) return Array(n).fill("none");

  // Any nonzero side is worth at least one block, so a 1-line change in a
  // 500-line PR still shows up rather than rounding away to nothing.
  let greens = add > 0 ? Math.min(n, Math.max(1, Math.round((add / total) * n))) : 0;
  let reds = del > 0 ? Math.max(1, Math.round((del / total) * n)) : 0;
  if (greens + reds > n) {
    // Trim the larger share so both stay visible.
    if (greens >= reds) greens = n - reds;
    else reds = n - greens;
  }

  return [
    ...Array(greens).fill("add"),
    ...Array(reds).fill("del"),
    ...Array(Math.max(0, n - greens - reds)).fill("none"),
  ];
}

/**
 * Milliseconds between `iso` and `nowMs`, clamped at zero.
 *
 * Returns `null` for a missing or unparseable timestamp — GitHub leaves these
 * fields null often enough that every caller needs the same guard.
 */
function elapsedMs(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, nowMs - parsed);
}

export type WaitLevel = "normal" | "warn" | "stale";

/** "3d" / "5h" / "12m" plus an escalation level based on how long it's been waiting. */
export function waitingLabel(
  since: string | null,
  nowMs: number,
): { short: string; level: WaitLevel } | null {
  const ms = elapsedMs(since, nowMs);
  if (ms === null) return null;

  const mins = Math.floor(ms / MINUTE_MS);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  return {
    short: days > 0 ? `${days}d` : hours > 0 ? `${hours}h` : `${Math.max(1, mins)}m`,
    level:
      days >= STALE_AFTER_DAYS
        ? "stale"
        : days >= WARN_AFTER_DAYS
          ? "warn"
          : "normal",
  };
}

export type ReviewSummary = {
  approved: number;
  changesRequested: number;
  commented: number;
  pending: number;
  /** The viewer's own latest review state, if they are a reviewer. */
  viewer: PrReviewer["state"] | null;
};

const REVIEW_BUCKET = {
  approved: "approved",
  changes_requested: "changesRequested",
  commented: "commented",
  pending: "pending",
} as const satisfies Record<string, keyof ReviewSummary>;

export function reviewSummary(
  reviewers: PrReviewer[],
  viewerLogin?: string | null,
): ReviewSummary {
  const summary: ReviewSummary = {
    approved: 0,
    changesRequested: 0,
    commented: 0,
    pending: 0,
    viewer: null,
  };

  for (const reviewer of reviewers) {
    const bucket = REVIEW_BUCKET[reviewer.state as keyof typeof REVIEW_BUCKET];
    if (bucket) summary[bucket] += 1;
    if (viewerLogin && reviewer.login === viewerLogin) summary.viewer = reviewer.state;
  }

  return summary;
}

/** Days since a PR was merged, for windowing the "recently merged" section. */
export function daysSince(iso: string | null, nowMs: number): number | null {
  const ms = elapsedMs(iso, nowMs);
  return ms === null ? null : Math.floor(ms / DAY_MS);
}

const updatedMs = (pr: GithubPr) => Date.parse(pr.updatedAt ?? "");
const churn = (pr: GithubPr) => (pr.additions ?? 0) + (pr.deletions ?? 0);

/** Sort comparators for the dashboard toolbar. */
export const PR_SORTS = {
  updated: (a: GithubPr, b: GithubPr) => updatedMs(b) - updatedMs(a),
  oldest: (a: GithubPr, b: GithubPr) => updatedMs(a) - updatedMs(b),
  largest: (a: GithubPr, b: GithubPr) => churn(b) - churn(a),
} as const;

export type PrSort = keyof typeof PR_SORTS;
