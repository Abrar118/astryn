import type { GithubPr, PrReviewer } from "@/lib/commands";

/** Distribute additions/deletions across `n` blocks for a GitHub-style diff bar. */
export function diffBlocks(
  additions: number | null,
  deletions: number | null,
  n = 5,
): ("add" | "del" | "none")[] {
  const add = Math.max(0, additions ?? 0);
  const del = Math.max(0, deletions ?? 0);
  const total = add + del;
  if (total === 0) return Array(n).fill("none");
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

export type WaitLevel = "normal" | "warn" | "stale";

/** "3d" / "5h" / "12m" plus an escalation level based on how long it's been waiting. */
export function waitingLabel(since: string | null, nowMs: number): { short: string; level: WaitLevel } | null {
  if (!since) return null;
  const t = Date.parse(since);
  if (Number.isNaN(t)) return null;
  const ms = Math.max(0, nowMs - t);
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  const short = days > 0 ? `${days}d` : hours > 0 ? `${hours}h` : `${Math.max(1, mins)}m`;
  const level: WaitLevel = days >= 5 ? "stale" : days >= 2 ? "warn" : "normal";
  return { short, level };
}

export type ReviewSummary = {
  approved: number;
  changesRequested: number;
  commented: number;
  pending: number;
  /** The viewer's own latest review state, if they are a reviewer. */
  viewer: PrReviewer["state"] | null;
};

export function reviewSummary(reviewers: PrReviewer[], viewerLogin?: string | null): ReviewSummary {
  const s: ReviewSummary = { approved: 0, changesRequested: 0, commented: 0, pending: 0, viewer: null };
  for (const r of reviewers) {
    if (r.state === "approved") s.approved++;
    else if (r.state === "changes_requested") s.changesRequested++;
    else if (r.state === "commented") s.commented++;
    else if (r.state === "pending") s.pending++;
    if (viewerLogin && r.login === viewerLogin) s.viewer = r.state;
  }
  return s;
}

/** Days since a PR was merged, for windowing the "recently merged" section. */
export function daysSince(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor(Math.max(0, nowMs - t) / 86_400_000);
}

/** Sort comparators for the dashboard toolbar. */
export const PR_SORTS = {
  updated: (a: GithubPr, b: GithubPr) => Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? ""),
  oldest: (a: GithubPr, b: GithubPr) => Date.parse(a.updatedAt ?? "") - Date.parse(b.updatedAt ?? ""),
  largest: (a: GithubPr, b: GithubPr) =>
    (b.additions ?? 0) + (b.deletions ?? 0) - ((a.additions ?? 0) + (a.deletions ?? 0)),
} as const;

export type PrSort = keyof typeof PR_SORTS;
