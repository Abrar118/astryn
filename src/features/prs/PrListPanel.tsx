import { FolderGit2, GitPullRequest } from "lucide-react";
import type { GithubPr, GithubSyncMeta } from "@/lib/commands";
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
    <div className="sticky top-0 z-10 flex items-center gap-2 border-y border-border/60 bg-muted/80 px-4 py-2 backdrop-blur">
      <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate font-mono text-[11.5px]">
        <span className="text-muted-foreground">{owner}</span>
        <span className="font-medium text-foreground">{name}</span>
      </span>
      <span className="rounded bg-background/70 px-1 text-[10px] tabular-nums text-muted-foreground">
        {count}
      </span>
    </div>
  );
}

export function PrListPanel({
  title,
  empty,
  prs,
  meta,
  stale,
  viewerLogin,
  groupByRepo,
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
  onOpenPr?: (pr: GithubPr, origin: HTMLElement) => void;
  onOpenMenu?: (pr: GithubPr, point: PrMenuPoint, origin: HTMLElement) => void;
}) {
  const groups = groupByRepo ? groupedByRepository(prs) : null;
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border/50 bg-muted/10 px-4 py-3">
        <GitPullRequest className="size-4 text-primary" />
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
          {prs.length}
        </span>
        {meta?.truncated && (
          <span className="truncate text-xs text-amber-400">
            showing {meta.fetchedCount} most recent
          </span>
        )}
        {stale && (
          <span className="truncate text-xs text-amber-400">
            couldn't refresh — cached
          </span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-24">
        {prs.length === 0 ? (
          <div className="flex h-full min-h-36 items-center justify-center gap-2.5 px-5 py-10 text-sm text-muted-foreground">
            <GitPullRequest className="size-4 opacity-50" />
            <span>{empty}</span>
          </div>
        ) : groups ? (
          groups.map(([repo, rows]) => (
            <div key={repo}>
              <RepositoryHeader repo={repo} count={rows.length} />
              {rows.map((pr) => (
                <PrRow
                  key={`${pr.bucket}:${pr.id}`}
                  pr={pr}
                  viewerLogin={viewerLogin}
                  onOpen={onOpenPr}
                  onOpenMenu={onOpenMenu}
                />
              ))}
            </div>
          ))
        ) : (
          prs.map((pr) => (
            <PrRow
              key={`${pr.bucket}:${pr.id}`}
              pr={pr}
              viewerLogin={viewerLogin}
              onOpen={onOpenPr}
              onOpenMenu={onOpenMenu}
            />
          ))
        )}
      </div>
    </section>
  );
}
