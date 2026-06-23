import { Clock } from "lucide-react";
import type { GithubPr, PrReviewer } from "@/lib/commands";
import { StatusIcon, PRIORITIES } from "@/features/drawer/issueGlyphs";
import { diffBlocks, waitingLabel, reviewSummary } from "./prDisplay";

/** +adds / −dels with a 5-block GitHub-style diff bar. */
export function DiffStat({ pr }: { pr: GithubPr }) {
  if (pr.additions == null && pr.deletions == null) return null;
  const blocks = diffBlocks(pr.additions, pr.deletions);
  const files = pr.changedFiles ?? 0;
  return (
    <span
      className="flex shrink-0 items-center gap-1.5"
      title={`+${pr.additions ?? 0} −${pr.deletions ?? 0} · ${files} file${files === 1 ? "" : "s"} changed`}
    >
      <span className="font-mono text-[12px] text-emerald-400">+{pr.additions ?? 0}</span>
      <span className="font-mono text-[12px] text-red-400">−{pr.deletions ?? 0}</span>
      <span className="flex gap-[2px]">
        {blocks.map((b, i) => (
          <span
            key={i}
            className={`size-2 rounded-[1.5px] ${b === "add" ? "bg-emerald-500" : b === "del" ? "bg-red-500" : "bg-muted"}`}
          />
        ))}
      </span>
    </span>
  );
}

const RING: Record<PrReviewer["state"], string> = {
  approved: "ring-emerald-500",
  changes_requested: "ring-amber-500",
  commented: "ring-sky-500",
  dismissed: "ring-muted-foreground/40",
  pending: "ring-muted-foreground/40",
};

const STATE_WORD: Record<PrReviewer["state"], string> = {
  approved: "approved",
  changes_requested: "requested changes",
  commented: "commented",
  dismissed: "dismissed",
  pending: "review pending",
};

/** Reviewer avatars, each ringed by their review state. */
export function ReviewProgress({ reviewers }: { reviewers: PrReviewer[] }) {
  if (!reviewers.length) return null;
  const shown = reviewers.slice(0, 4);
  const extra = reviewers.length - shown.length;
  const summary = reviewers.map((r) => `${r.login} — ${STATE_WORD[r.state]}`).join("\n");
  return (
    <span className="flex shrink-0 items-center gap-1" title={summary} aria-label={summary}>
      {shown.map((r) =>
        r.avatar ? (
          <img
            key={r.login}
            src={r.avatar}
            alt=""
            className={`size-5 rounded-full ring-2 ${RING[r.state]}`}
          />
        ) : (
          <span
            key={r.login}
            className={`flex size-5 items-center justify-center rounded-full bg-muted text-[10px] uppercase ring-2 ${RING[r.state]}`}
          >
            {r.login.slice(0, 1)}
          </span>
        ),
      )}
      {extra > 0 && <span className="text-[11px] text-muted-foreground">+{extra}</span>}
    </span>
  );
}

/** The viewer's own review verdict, falling back to the PR's aggregate decision. */
const AGG: Record<NonNullable<GithubPr["reviewDecision"]>, { label: string; cls: string }> = {
  approved: { label: "Approved", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  changes_requested: { label: "Changes requested", cls: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  review_required: { label: "Review required", cls: "border-border bg-muted/40 text-muted-foreground" },
};

export function ReviewState({ pr, viewerLogin }: { pr: GithubPr; viewerLogin?: string | null }) {
  const sum = reviewSummary(pr.reviewers, viewerLogin);
  let badge: { label: string; cls: string } | null = null;
  if (sum.viewer === "changes_requested") badge = { label: "You requested changes", cls: AGG.changes_requested.cls };
  else if (sum.viewer === "approved") badge = { label: "You approved", cls: AGG.approved.cls };
  else if (sum.viewer === "commented") badge = { label: "You commented", cls: "border-sky-500/30 bg-sky-500/10 text-sky-300" };
  else if (pr.reviewDecision) badge = AGG[pr.reviewDecision];
  if (!badge) return null;
  return (
    <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${badge.cls}`}>
      {badge.label}
    </span>
  );
}

/** Escalating "waiting Nd" pill — emphasizes PRs sitting in your queue. */
export function WaitingBadge({ pr }: { pr: GithubPr }) {
  const w = waitingLabel(pr.updatedAt, Date.now());
  if (!w) return null;
  const cls = w.level === "stale" ? "text-red-400" : w.level === "warn" ? "text-amber-400" : "text-muted-foreground";
  return (
    <span className={`flex shrink-0 items-center gap-1 ${cls}`} title={`Waiting ${w.short}`}>
      <Clock className="size-3.5" /> {w.short}
    </span>
  );
}

/** Linked Linear issue's workflow state + priority — the on-brand differentiator. */
export function LinearIssueState({ pr }: { pr: GithubPr }) {
  if (!pr.linearStateName) return null;
  const prio = pr.linearPriority != null ? PRIORITIES.find((p) => p.value === pr.linearPriority) : undefined;
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {prio && prio.value !== 0 && (
        <span className="size-2.5 rounded-full" style={{ backgroundColor: prio.color }} title={`Priority: ${prio.label}`} />
      )}
      <span className="flex items-center gap-1.5" title={`Linear status: ${pr.linearStateName}`}>
        <StatusIcon type={pr.linearStateType ?? ""} color={pr.linearStateColor ?? ""} />
        <span className="text-xs text-muted-foreground">{pr.linearStateName}</span>
      </span>
    </span>
  );
}
