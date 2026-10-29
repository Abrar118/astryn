import type { KeyboardEvent, MouseEvent } from "react";
import { MessageSquare, MoreHorizontal } from "lucide-react";
import { useWorkspace } from "@/lib/tabs";
import { timeAgo } from "@/features/drawer/timeAgo";
import type { GithubPr } from "@/lib/commands";
import { BranchGraph } from "./BranchGraph";
import {
  CiLegend,
  DiffStat,
  LinearIssueState,
  PrHealthLamp,
  ReviewProgress,
  ReviewState,
  WaitingBadge,
  prHealth,
} from "./prBadges";

export type PrMenuPoint = { x: number; y: number };

export function PrRow({
  pr,
  viewerLogin,
  showRepo = true,
  onOpen,
  onOpenMenu,
}: {
  pr: GithubPr;
  viewerLogin?: string | null;
  /** Off when the row already sits under its repository's group header. */
  showRepo?: boolean;
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
    <div className="group relative grid grid-cols-[8px_minmax(0,1fr)] gap-x-3 px-4 py-3">
      <div
        role="button"
        tabIndex={0}
        aria-label={`${title} pull request, ${prHealth(pr).label.toLowerCase()}`}
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
        className="dash-control absolute inset-0 z-0 transition-colors hover:bg-accent"
      />

      <PrHealthLamp pr={pr} className="pointer-events-none relative z-10 flex h-5 items-center" />

      <div className="pointer-events-none relative z-10 flex min-w-0 flex-col gap-1.5">
        {/* Line 1: title; Linear identifier, time and actions pinned right */}
        <div className="flex h-5 items-center gap-3">
          <span className="min-w-0 truncate text-[14px] font-medium text-foreground">
            {title}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-3">
            {pr.linearIssueId && (
              <button
                type="button"
                aria-label={`Open ${pr.linearIdentifier}`}
                onClick={(event) => {
                  event.stopPropagation();
                  openIssueTab(pr.linearIssueId!);
                }}
                onKeyDown={(event) => event.stopPropagation()}
                className="dash-control pointer-events-auto relative z-20 rounded-md border border-input px-1.5 font-mono text-[12px] leading-5 text-foreground transition-colors hover:bg-background"
              >
                {pr.linearIdentifier}
              </button>
            )}
            <span data-testid="pr-updated" className="text-[12px] tabular-nums text-muted-foreground">{relative}</span>
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
              className="dash-control pointer-events-auto relative z-20 -my-0.5 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </span>
        </div>

        {/* Line 2: state legends, then branch, repo and size; people pinned right */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          {pr.draft && <span className="shrink-0 font-medium">draft</span>}
          {pr.bucket === "merged" && <span className="shrink-0 font-medium text-merged">merged</span>}
          {pr.bucket !== "merged" && <ReviewState pr={pr} viewerLogin={viewerLogin} />}
          {pr.mergeable === "conflicting" && (
            <span className="shrink-0 font-medium text-destructive">conflict</span>
          )}
          <CiLegend status={pr.ciStatus} />
          <BranchGraph pr={pr} />
          {showRepo && <span className="hidden shrink-0 truncate font-mono sm:inline">{pr.repo}</span>}
          <span className="shrink-0 tabular-nums">#{pr.number}</span>
          <DiffStat pr={pr} />
          {pr.commentCount != null && pr.commentCount > 0 && (
            <span className="flex shrink-0 items-center gap-1 tabular-nums" title={`${pr.commentCount} comments`}>
              <MessageSquare aria-hidden className="size-3.5" /> {pr.commentCount}
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
                  className="size-5 rounded-full"
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
