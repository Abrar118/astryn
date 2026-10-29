import { Clock } from "lucide-react";
import type { GithubPr, PrReviewer } from "@/lib/commands";
import { IndicatorLamp, type Lamp } from "@/components/IndicatorLamp";
import { StatusIcon, PRIORITIES } from "@/features/drawer/issueGlyphs";
import { waitingLabel, reviewSummary } from "./prDisplay";

/**
 * The one lamp that leads a pull request row: the worst state wins, so a
 * glance down the lamp column finds what is blocked.
 */
export function prHealth(pr: GithubPr): { tone: Lamp; label: string; className?: string } {
  if (pr.bucket === "merged") return { tone: "neutral", label: "Merged", className: "bg-merged" };
  if (pr.mergeable === "conflicting") return { tone: "danger", label: "Merge conflict" };
  if (pr.ciStatus === "failure") return { tone: "danger", label: "CI failing" };
  if (pr.reviewDecision === "changes_requested") return { tone: "warning", label: "Changes requested" };
  if (pr.draft) return { tone: "off", label: "Draft" };
  if (pr.reviewDecision === "approved") return { tone: "success", label: "Approved" };
  return { tone: "neutral", label: "Open" };
}

/** The health lamp; callers put `prHealth(pr).label` in the row's accessible name. */
export function PrHealthLamp({ pr, className }: { pr: GithubPr; className?: string }) {
  const health = prHealth(pr);
  return (
    <span title={health.label} className={className}>
      <IndicatorLamp tone={health.tone} className={health.className} />
    </span>
  );
}

/** +additions −deletions, quiet in a list; the diff view carries the colour. */
export function DiffStat({ pr }: { pr: GithubPr }) {
  if (pr.additions == null && pr.deletions == null) return null;
  const files = pr.changedFiles ?? 0;
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 font-mono text-[12px] tabular-nums"
      title={`+${pr.additions ?? 0} −${pr.deletions ?? 0} · ${files} file${files === 1 ? "" : "s"} changed`}
    >
      <span>+{pr.additions ?? 0}</span>
      <span>−{pr.deletions ?? 0}</span>
    </span>
  );
}

/** CI as a small lamp legend: lit in the state colour, "ci" as the legend. */
export function CiLegend({ status }: { status: GithubPr["ciStatus"] }) {
  if (!status || status === "none") return null;
  const map = {
    success: { tone: "success", label: "CI passing" },
    failure: { tone: "danger", label: "CI failing" },
    pending: { tone: "info", label: "CI pending" },
  } as const;
  const { tone, label } = map[status];
  return (
    <span title={label} className="flex shrink-0 items-center gap-1.5">
      <IndicatorLamp tone={tone} className="size-1.5" />
      <span aria-hidden className={status === "failure" ? "text-destructive" : undefined}>ci</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

const RING: Record<PrReviewer["state"], string> = {
  approved: "ring-success",
  changes_requested: "ring-warning",
  commented: "ring-info",
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
            className={`flex size-5 items-center justify-center rounded-full bg-muted text-[11px] ring-2 ${RING[r.state]}`}
          >
            {r.login.slice(0, 1).toUpperCase()}
          </span>
        ),
      )}
      {extra > 0 && <span className="text-[12px] text-muted-foreground">+{extra}</span>}
    </span>
  );
}

/** The viewer's own review verdict, falling back to the PR's aggregate decision. */
const AGG: Record<NonNullable<GithubPr["reviewDecision"]>, { label: string; cls: string }> = {
  approved: { label: "approved", cls: "text-success" },
  changes_requested: { label: "changes requested", cls: "text-warning" },
  review_required: { label: "review required", cls: "text-muted-foreground" },
};

/** The review verdict as a lowercase legend in its state colour; no pill. */
export function ReviewState({ pr, viewerLogin }: { pr: GithubPr; viewerLogin?: string | null }) {
  const sum = reviewSummary(pr.reviewers, viewerLogin);
  let badge: { label: string; cls: string } | null = null;
  if (sum.viewer === "changes_requested") badge = { label: "you requested changes", cls: AGG.changes_requested.cls };
  else if (sum.viewer === "approved") badge = { label: "you approved", cls: AGG.approved.cls };
  else if (sum.viewer === "commented") badge = { label: "you commented", cls: "text-info" };
  else if (pr.reviewDecision) badge = AGG[pr.reviewDecision];
  if (!badge) return null;
  return <span className={`shrink-0 font-medium ${badge.cls}`}>{badge.label}</span>;
}

/** Escalating "waiting Nd" reading — emphasizes PRs sitting in your queue. */
export function WaitingBadge({ pr }: { pr: GithubPr }) {
  const w = waitingLabel(pr.updatedAt, Date.now());
  if (!w) return null;
  const cls = w.level === "stale" ? "text-destructive" : w.level === "warn" ? "text-warning" : "text-muted-foreground";
  return (
    <span className={`flex shrink-0 items-center gap-1 tabular-nums ${cls}`} title={`Waiting ${w.short}`}>
      <Clock aria-hidden className="size-3.5" /> {w.short}
    </span>
  );
}

/** Linked Linear issue's workflow state + priority — Linear's own colours pass through. */
export function LinearIssueState({ pr }: { pr: GithubPr }) {
  if (!pr.linearStateName) return null;
  const prio = pr.linearPriority != null ? PRIORITIES.find((p) => p.value === pr.linearPriority) : undefined;
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {prio && prio.value !== 0 && (
        <span className="size-2 rounded-full" style={{ backgroundColor: prio.color }} title={`Priority: ${prio.label}`} />
      )}
      <span className="flex items-center gap-1.5" title={`Linear status: ${pr.linearStateName}`}>
        <StatusIcon type={pr.linearStateType ?? ""} color={pr.linearStateColor ?? ""} />
        <span>{pr.linearStateName}</span>
      </span>
    </span>
  );
}
