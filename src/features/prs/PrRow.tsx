import type { KeyboardEvent, MouseEvent } from "react";
import {
  CheckCircle2,
  Clock,
  GitMerge,
  GitPullRequest,
  MessageSquare,
  MoreHorizontal,
  XCircle,
} from "lucide-react";
import { useWorkspace } from "@/lib/tabs";
import { timeAgo } from "@/features/drawer/timeAgo";
import type { GithubPr } from "@/lib/commands";
import { BranchGraph } from "./BranchGraph";
import { DiffStat, ReviewProgress, ReviewState, WaitingBadge, LinearIssueState } from "./prBadges";

function CiBadge({ status }: { status: GithubPr["ciStatus"] }) {
  if (!status || status === "none") return null;
  const map = {
    success: { Icon: CheckCircle2, cls: "text-emerald-400", label: "CI passing" },
    failure: { Icon: XCircle, cls: "text-red-400", label: "CI failing" },
    pending: { Icon: Clock, cls: "text-amber-400", label: "CI pending" },
  } as const;
  const { Icon, cls, label } = map[status];
  return <Icon aria-label={label} className={`size-4 ${cls}`} />;
}

export type PrMenuPoint = { x: number; y: number };

export function PrRow({
  pr,
  viewerLogin,
  onOpen,
  onOpenMenu,
}: {
  pr: GithubPr;
  viewerLogin?: string | null;
  onOpen?: (pr: GithubPr, origin: HTMLElement) => void;
  onOpenMenu?: (pr: GithubPr, point: PrMenuPoint, origin: HTMLElement) => void;
}) {
  const { openIssueTab } = useWorkspace();
  const relative = pr.updatedAt ? timeAgo(pr.updatedAt) : "";
  const showWaiting = pr.bucket === "needs_review" || pr.bucket === "assigned";
  const title = pr.title ?? "(untitled)";

  const openMenuFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onOpenMenu?.(
      pr,
      { x: Math.min(rect.left + 24, rect.right), y: Math.min(rect.top + 24, rect.bottom) },
      event.currentTarget,
    );
  };

  return (
    <div
      className="group relative flex items-start gap-3.5 border-b border-border/50 px-5 py-3.5 last:border-b-0"
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={`${title} pull request`}
        onClick={(event) => onOpen?.(pr, event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen?.(pr, event.currentTarget);
          } else if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            openMenuFromKeyboard(event);
          }
        }}
        onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
          event.preventDefault();
          onOpenMenu?.(
            pr,
            { x: event.clientX, y: event.clientY },
            event.currentTarget,
          );
        }}
        className="absolute inset-0 z-0 cursor-pointer outline-none transition-colors hover:bg-white/[0.03] focus-visible:bg-primary/[0.06] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
      />

      <span className="pointer-events-none relative z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/40">
        <GitPullRequest className={`size-4 ${pr.draft ? "text-muted-foreground" : "text-emerald-400"}`} />
      </span>

      <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 flex-col gap-2.5">
        {/* Line 1: title + status badges; Linear chip and time pinned right */}
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-left text-[15px] font-medium text-foreground">
            {title}
          </span>

          {pr.bucket !== "merged" && (
            <span className="shrink-0 rounded-md border border-border/70 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {pr.draft ? "Draft" : "Open"}
            </span>
          )}
          {pr.bucket === "merged" && (
            <span className="flex shrink-0 items-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[11px] font-medium text-purple-300">
              <GitMerge className="size-3.5" /> Merged
            </span>
          )}
          {pr.bucket !== "merged" && <ReviewState pr={pr} viewerLogin={viewerLogin} />}
          {pr.mergeable === "conflicting" && (
            <span className="flex shrink-0 items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">
              <GitMerge className="size-3.5" /> Conflict
            </span>
          )}
          <CiBadge status={pr.ciStatus} />

          <span className="ml-auto flex shrink-0 items-center gap-2.5">
            {pr.linearIssueId && (
              <button
                type="button"
                aria-label={`Open ${pr.linearIdentifier}`}
                onClick={(event) => {
                  event.stopPropagation();
                  openIssueTab(pr.linearIssueId!);
                }}
                onKeyDown={(event) => event.stopPropagation()}
                className="pointer-events-auto relative z-20 rounded-md border border-primary/40 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
              >
                {pr.linearIdentifier}
              </button>
            )}
            <span data-testid="pr-updated" className="text-xs text-muted-foreground">{relative}</span>
            <button
              type="button"
              aria-label={`Actions for ${title}`}
              onClick={(event) => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                onOpenMenu?.(
                  pr,
                  { x: rect.right, y: rect.bottom },
                  event.currentTarget,
                );
              }}
              onKeyDown={(event) => event.stopPropagation()}
              className="pointer-events-auto relative z-20 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </span>
        </div>

        {/* Line 2: branch graph + diff/meta; reviewers/author pinned right */}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs text-muted-foreground">
          <BranchGraph pr={pr} />
          <span className="hidden h-3.5 w-px shrink-0 bg-border sm:block" />
          <span className="hidden shrink-0 truncate font-mono text-[11.5px] sm:inline">{pr.repo}</span>
          <span className="shrink-0">#{pr.number}</span>
          <DiffStat pr={pr} />
          {pr.commentCount != null && pr.commentCount > 0 && (
            <span className="flex shrink-0 items-center gap-0.5">
              <MessageSquare className="size-3.5" /> {pr.commentCount}
            </span>
          )}
          <LinearIssueState pr={pr} />

          <span className="ml-auto flex shrink-0 items-center gap-3">
            {showWaiting && <WaitingBadge pr={pr} />}
            <ReviewProgress reviewers={pr.reviewers} />
            <span className="flex items-center gap-1.5">
              {pr.authorAvatar && (
                <img
                  src={pr.authorAvatar}
                  alt={pr.authorLogin ? `${pr.authorLogin} avatar` : "author"}
                  className="size-5 rounded-full ring-1 ring-border"
                />
              )}
              {pr.authorLogin && <span>{pr.authorLogin}</span>}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
