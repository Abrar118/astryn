import type { ReactNode } from "react";
import type { GithubPr, GithubSyncMeta } from "@/lib/commands";
import { IndicatorLamp } from "@/components/IndicatorLamp";
import { PrRow, type PrMenuPoint } from "./PrRow";

function groupedByRepository(prs: GithubPr[]): [string, GithubPr[]][] {
  const groups = new Map<string, GithubPr[]>();
  for (const pr of prs) {
    const rows = groups.get(pr.repo) ?? [];
    rows.push(pr);
    groups.set(pr.repo, rows);
  }
  return [...groups.entries()];
}

function RepositoryHeader({ repo, count }: { repo: string; count: number }) {
  const cut = repo.lastIndexOf("/");
  const owner = cut >= 0 ? repo.slice(0, cut + 1) : "";
  const name = cut >= 0 ? repo.slice(cut + 1) : repo;
  return (
    <div className="sticky top-0 z-30 flex items-baseline gap-2 border-y border-border bg-muted px-4 py-1.5 first:border-t-0">
      <span className="truncate font-mono text-[12px]">
        <span className="text-muted-foreground">{owner}</span>
        <span className="font-medium text-foreground">{name}</span>
      </span>
      <span className="text-[12px] tabular-nums text-muted-foreground">{count}</span>
    </div>
  );
}

/** The queue zone of the PR faceplate: heading and controls over hairline rows. */
export function PrListPanel({
  title,
  empty,
  prs,
  meta,
  stale,
  viewerLogin,
  groupByRepo,
  controls,
  onOpenPr,
  onOpenMenu,
}: {
  title: string;
  empty: string;
  prs: GithubPr[];
  meta?: GithubSyncMeta;
  stale?: boolean;
  viewerLogin?: string | null;
  groupByRepo: boolean;
  controls?: ReactNode;
  onOpenPr?: (pr: GithubPr, origin: HTMLElement) => void;
  onOpenMenu?: (pr: GithubPr, point: PrMenuPoint, origin: HTMLElement) => void;
}) {
  const groups = groupByRepo ? groupedByRepository(prs) : null;
  const rows = (list: GithubPr[], showRepo: boolean) => (
    <div className="divide-y divide-border/70">
      {list.map((pr) => (
        <PrRow
          key={`${pr.bucket}:${pr.id}`}
          pr={pr}
          showRepo={showRepo}
          viewerLogin={viewerLogin}
          onOpen={onOpenPr}
          onOpenMenu={onOpenMenu}
        />
      ))}
    </div>
  );
  return (
    <section className="dash-zone flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h2 className="truncate text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
          <span className="text-[13px] tabular-nums text-muted-foreground">{prs.length}</span>
          {meta?.truncated && (
            <span className="flex items-center gap-1.5 self-center truncate text-[12px] text-muted-foreground">
              <IndicatorLamp tone="warning" />
              showing {meta.fetchedCount} most recent
            </span>
          )}
          {stale && (
            <span className="flex items-center gap-1.5 self-center truncate text-[12px] text-foreground">
              <IndicatorLamp tone="warning" />
              couldn't refresh — cached
            </span>
          )}
        </div>
        {controls}
      </header>

      <div className="drawer-scrollbar min-h-0 flex-1 overflow-y-auto pb-24">
        {prs.length === 0 ? (
          <div className="flex items-start gap-3 px-4 py-6">
            <IndicatorLamp tone="off" className="mt-1.5" />
            <p className="text-[13px] text-muted-foreground">{empty}</p>
          </div>
        ) : groups ? (
          groups.map(([repo, list]) => (
            <div key={repo}>
              <RepositoryHeader repo={repo} count={list.length} />
              {rows(list, false)}
            </div>
          ))
        ) : (
          rows(prs, true)
        )}
      </div>
    </section>
  );
}
