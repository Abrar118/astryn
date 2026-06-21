import { openUrl } from "@tauri-apps/plugin-opener";
import { GitPullRequest, MessageSquare, GitMerge, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useWorkspace } from "@/lib/tabs";
import { timeAgo } from "@/features/drawer/timeAgo";
import type { GithubPr } from "@/lib/commands";

const REVIEW_LABEL: Record<NonNullable<GithubPr["reviewDecision"]>, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  review_required: "Review required",
};

function CiBadge({ status }: { status: GithubPr["ciStatus"] }) {
  if (!status || status === "none") return null;
  const map = {
    success: { Icon: CheckCircle2, cls: "text-emerald-400", label: "CI passing" },
    failure: { Icon: XCircle, cls: "text-red-400", label: "CI failing" },
    pending: { Icon: Clock, cls: "text-amber-400", label: "CI pending" },
  } as const;
  const { Icon, cls, label } = map[status];
  return <Icon aria-label={label} className={`size-3.5 ${cls}`} />;
}

export function PrRow({ pr }: { pr: GithubPr }) {
  const { openIssueTab } = useWorkspace();
  const relative = pr.updatedAt ? timeAgo(pr.updatedAt) : "";

  return (
    <div className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 text-sm hover:bg-white/5">
      <GitPullRequest className={`size-4 shrink-0 ${pr.draft ? "text-muted-foreground" : "text-emerald-400"}`} />
      <button
        type="button"
        onClick={() => pr.url && openUrl(pr.url)}
        className="min-w-0 flex-1 truncate text-left text-foreground hover:underline"
      >
        {pr.title ?? "(untitled)"}
      </button>

      <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
        {pr.draft ? "Draft" : "Open"}
      </span>
      {pr.reviewDecision && (
        <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {REVIEW_LABEL[pr.reviewDecision]}
        </span>
      )}
      {pr.mergeable === "conflicting" && (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-amber-400">
          <GitMerge className="size-3.5" /> Conflict
        </span>
      )}
      <CiBadge status={pr.ciStatus} />

      {pr.linearIssueId && (
        <button
          type="button"
          aria-label={`Open ${pr.linearIdentifier}`}
          onClick={() => openIssueTab(pr.linearIssueId!)}
          className="shrink-0 rounded-md border border-primary/40 px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10"
        >
          {pr.linearIdentifier}
        </button>
      )}

      <span className="shrink-0 text-[11px] text-muted-foreground">#{pr.number}</span>
      <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{pr.repo}</span>
      {pr.commentCount != null && pr.commentCount > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
          <MessageSquare className="size-3" /> {pr.commentCount}
        </span>
      )}
      {pr.authorAvatar && (
        <img src={pr.authorAvatar} alt={pr.authorLogin ? `${pr.authorLogin} avatar` : "author"} className="size-4 shrink-0 rounded-full" />
      )}
      {pr.authorLogin && (
        <span className="shrink-0 text-[11px] text-muted-foreground">{pr.authorLogin}</span>
      )}
      <span data-testid="pr-updated" className="shrink-0 text-[11px] text-muted-foreground">{relative}</span>
    </div>
  );
}
