import { openUrl } from "@tauri-apps/plugin-opener";
import { GitPullRequest, MessageSquare, GitMerge, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useWorkspace } from "@/lib/tabs";
import { timeAgo } from "@/features/drawer/timeAgo";
import type { GithubPr } from "@/lib/commands";
import { BranchGraph } from "./BranchGraph";

const REVIEW_STYLE: Record<NonNullable<GithubPr["reviewDecision"]>, { label: string; cls: string }> = {
  approved: { label: "Approved", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  changes_requested: { label: "Changes requested", cls: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  review_required: { label: "Review required", cls: "border-border bg-muted/40 text-muted-foreground" },
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
  const review = pr.reviewDecision ? REVIEW_STYLE[pr.reviewDecision] : null;

  return (
    <div className="group flex items-start gap-3 border-b border-border/50 px-4 py-3 last:border-b-0 transition-colors hover:bg-white/[0.03]">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/40">
        <GitPullRequest className={`size-3.5 ${pr.draft ? "text-muted-foreground" : "text-emerald-400"}`} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/* Line 1: title + status badges, with Linear chip and time on the right */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => pr.url && openUrl(pr.url)}
            className="min-w-0 truncate text-left text-sm font-medium text-foreground decoration-muted-foreground/40 underline-offset-2 hover:underline"
          >
            {pr.title ?? "(untitled)"}
          </button>

          <span className="shrink-0 rounded-md border border-border/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {pr.draft ? "Draft" : "Open"}
          </span>
          {review && (
            <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${review.cls}`}>
              {review.label}
            </span>
          )}
          {pr.mergeable === "conflicting" && (
            <span className="flex shrink-0 items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
              <GitMerge className="size-3" /> Conflict
            </span>
          )}
          <CiBadge status={pr.ciStatus} />

          <span className="ml-auto flex shrink-0 items-center gap-2">
            {pr.linearIssueId && (
              <button
                type="button"
                aria-label={`Open ${pr.linearIdentifier}`}
                onClick={() => openIssueTab(pr.linearIssueId!)}
                className="rounded-md border border-primary/40 px-1.5 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10"
              >
                {pr.linearIdentifier}
              </button>
            )}
            <span data-testid="pr-updated" className="text-[11px] text-muted-foreground">{relative}</span>
          </span>
        </div>

        {/* Line 2: branch graph + repo/meta */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <BranchGraph pr={pr} />
          <span className="hidden h-3 w-px shrink-0 bg-border sm:block" />
          <span className="hidden shrink-0 truncate font-mono text-[10.5px] sm:inline">{pr.repo}</span>
          <span className="shrink-0">#{pr.number}</span>
          {pr.commentCount != null && pr.commentCount > 0 && (
            <span className="flex shrink-0 items-center gap-0.5">
              <MessageSquare className="size-3" /> {pr.commentCount}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {pr.authorAvatar && (
              <img
                src={pr.authorAvatar}
                alt={pr.authorLogin ? `${pr.authorLogin} avatar` : "author"}
                className="size-4 rounded-full ring-1 ring-border"
              />
            )}
            {pr.authorLogin && <span>{pr.authorLogin}</span>}
          </span>
        </div>
      </div>
    </div>
  );
}
