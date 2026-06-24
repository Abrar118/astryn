import { useState } from "react";
import {
  AtSign,
  Eye,
  FolderGit2,
  GitMerge,
  GitPullRequest,
  MessageSquareWarning,
  RefreshCw,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/tabs";
import {
  useGithubContributions,
  useGithubContributionsSync,
  useGithubPrs,
  useGithubStatus,
  useGithubSync,
} from "@/lib/queries";
import type { Contributions, GithubPr, GithubSyncMeta, PrBucket } from "@/lib/commands";
import { PrRow } from "./PrRow";
import { PrHeatMap } from "./PrHeatMap";
import { contributionsToWeeks, prStats, type PrStats } from "./prActivity";
import { PR_SORTS, type PrSort } from "./prDisplay";
import { PrToolbar, type PrFilter, type PrLayout } from "./PrToolbar";

/** Apply the toolbar's filter + sort to a bucket's PRs. */
function applyControls(list: GithubPr[], sort: PrSort, filter: PrFilter): GithubPr[] {
  let r = list;
  if (filter === "conflicts") r = r.filter((p) => p.mergeable === "conflicting");
  else if (filter === "ci_failing") r = r.filter((p) => p.ciStatus === "failure");
  return [...r].sort(PR_SORTS[sort]);
}

/** Group PRs by repository, preserving the incoming (already-sorted) order. */
function groupByRepoFn(prs: GithubPr[]): [string, GithubPr[]][] {
  const map = new Map<string, GithubPr[]>();
  for (const p of prs) {
    const list = map.get(p.repo) ?? [];
    list.push(p);
    map.set(p.repo, list);
  }
  return [...map.entries()];
}

const SECTIONS: { bucket: PrBucket; title: string; empty: string; icon: LucideIcon; tint: string }[] = [
  { bucket: "needs_review", title: "Needs my review", empty: "Nothing awaiting your review.", icon: Eye, tint: "text-indigo-400" },
  { bucket: "mine", title: "My open PRs", empty: "You have no open PRs.", icon: GitPullRequest, tint: "text-emerald-400" },
  { bucket: "involved", title: "Involved / mentioned", empty: "Nothing else involving you.", icon: AtSign, tint: "text-muted-foreground" },
  { bucket: "assigned", title: "Assigned to me", empty: "No PRs assigned to you.", icon: UserCheck, tint: "text-sky-400" },
];

const METRICS: { key: keyof PrStats; label: string; icon: LucideIcon; tint: string }[] = [
  { key: "open", label: "Open", icon: GitPullRequest, tint: "text-foreground" },
  { key: "needsReview", label: "Needs review", icon: Eye, tint: "text-indigo-400" },
  { key: "changesRequested", label: "Changes req.", icon: MessageSquareWarning, tint: "text-amber-400" },
  { key: "conflicts", label: "Conflicts", icon: GitMerge, tint: "text-red-400" },
];

function MetricTile({ value, label, Icon, tint }: { value: number; label: string; Icon: LucideIcon; tint: string }) {
  return (
    <div className="flex flex-col justify-between gap-2.5 rounded-xl border border-border/60 bg-background/40 px-4 py-3.5 transition-colors hover:border-border">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-[11px] font-medium uppercase tracking-wider">{label}</span>
        <Icon className={`size-4 ${tint}`} />
      </div>
      <span className="text-3xl font-semibold leading-none tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function ActivityCard({
  contributions,
  stats,
}: {
  contributions: Contributions | null | undefined;
  stats: PrStats;
}) {
  const weeks = contributionsToWeeks(contributions);
  const total = contributions?.total ?? 0;
  return (
    <section className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-3 flex items-baseline justify-between">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Activity</p>
            <p className="text-xs text-muted-foreground">
              {total.toLocaleString()} contributions · last year
            </p>
          </div>
          <PrHeatMap weeks={weeks} />
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2.5 lg:w-72">
          {METRICS.map((m) => (
            <MetricTile key={m.key} value={stats[m.key]} label={m.label} Icon={m.icon} tint={m.tint} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Section({
  title,
  empty,
  icon: Icon,
  tint,
  prs,
  meta,
  stale,
  viewerLogin,
  groupByRepo = false,
  layout,
}: {
  title: string;
  empty: string;
  icon: LucideIcon;
  tint: string;
  prs: GithubPr[];
  meta?: GithubSyncMeta;
  stale?: boolean;
  viewerLogin?: string | null;
  groupByRepo?: boolean;
  layout: PrLayout;
}) {
  const groups = groupByRepo ? groupByRepoFn(prs) : null;
  const board = layout === "board";
  return (
    <section
      className={`flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm ${
        board ? "min-h-0" : ""
      }`}
    >
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border/50 bg-muted/10 px-4 py-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/50">
          <Icon className={`size-4 ${tint}`} />
        </span>
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
          {prs.length}
        </span>
        {meta?.truncated && (
          <span className="truncate text-xs text-amber-400">showing {meta.fetchedCount} most recent</span>
        )}
        {stale && <span className="truncate text-xs text-amber-400">couldn't refresh — cached</span>}
      </header>
      <div className={board ? "min-h-0 flex-1 overflow-y-auto" : ""}>
        {prs.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2.5 px-5 py-10 text-sm text-muted-foreground">
            <Icon className="size-4 shrink-0 opacity-50" />
            <span>{empty}</span>
          </div>
        ) : groups ? (
          groups.map(([repo, rows]) => {
            const cut = repo.lastIndexOf("/");
            const org = cut >= 0 ? repo.slice(0, cut + 1) : "";
            const name = cut >= 0 ? repo.slice(cut + 1) : repo;
            return (
              <div key={repo}>
                <div
                  className={`flex items-center gap-2 border-b border-border/60 bg-muted/40 px-4 py-2 ${
                    board ? "sticky top-0 z-10 backdrop-blur" : ""
                  }`}
                >
                  <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-[11.5px]">
                    <span className="text-muted-foreground">{org}</span>
                    <span className="font-medium text-foreground">{name}</span>
                  </span>
                  <span className="flex h-4 min-w-4 items-center justify-center rounded bg-background/70 px-1 text-[10px] font-medium tabular-nums text-muted-foreground">
                    {rows.length}
                  </span>
                </div>
                {rows.map((pr) => (
                  <PrRow key={`${pr.bucket}:${pr.id}`} pr={pr} viewerLogin={viewerLogin} />
                ))}
              </div>
            );
          })
        ) : (
          prs.map((pr) => <PrRow key={`${pr.bucket}:${pr.id}`} pr={pr} viewerLogin={viewerLogin} />)
        )}
      </div>
    </section>
  );
}

export function PrsPage() {
  const { setActiveView } = useWorkspace();
  const { data: status } = useGithubStatus();
  const connected = status?.state === "connected" || status?.state === "unverified";
  const { data: dashboard } = useGithubPrs();
  const { data: contributions } = useGithubContributions();
  const sync = useGithubSync(connected);
  useGithubContributionsSync(connected);

  const [sort, setSort] = useState<PrSort>("updated");
  const [filter, setFilter] = useState<PrFilter>("all");
  const [groupByRepo, setGroupByRepo] = useState(false);
  const [layout, setLayout] = useState<PrLayout>("board");

  if (status?.state === "not_configured") {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-muted/50">
          <GitPullRequest className="size-7 text-muted-foreground" />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold text-foreground">Pull Requests</h1>
          <p className="max-w-xs text-sm text-muted-foreground">
            Link your GitHub account to see your pull requests.
          </p>
        </div>
        <Button onClick={() => setActiveView("settings")}>Connect GitHub</Button>
      </main>
    );
  }

  const allPrs = dashboard?.prs ?? [];
  const meta = dashboard?.meta ?? [];
  const openPrs = allPrs.filter((p) => p.bucket !== "merged");
  const stats = prStats(openPrs);
  const failed = new Set((sync.data ?? []).filter((r) => !r.ok).map((r) => r.bucket));
  const viewerLogin = status?.state === "connected" ? status.login : null;
  const board = layout === "board";

  const sections = SECTIONS.map((s) => (
    <Section
      key={s.bucket}
      title={s.title}
      empty={s.empty}
      icon={s.icon}
      tint={s.tint}
      prs={applyControls(openPrs.filter((p) => p.bucket === s.bucket), sort, filter)}
      meta={meta.find((m) => m.bucket === s.bucket)}
      stale={failed.has(s.bucket)}
      viewerLogin={viewerLogin}
      groupByRepo={groupByRepo}
      layout={layout}
    />
  ));

  return (
    <main className={`flex h-full flex-col ${board ? "overflow-hidden" : "overflow-y-auto"}`}>
      <header className="sticky top-0 z-20 flex shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-background/80 px-6 py-3 backdrop-blur">
        <div className="flex items-baseline gap-2">
          <h1 className="text-base font-semibold text-foreground">Pull Requests</h1>
          {status?.state === "connected" && (
            <span className="text-xs text-muted-foreground">@{status.login}</span>
          )}
          {sync.isError && (
            <span className="text-xs text-amber-400">Sync failed — showing cached data.</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Refresh"
          disabled={sync.isFetching}
          onClick={() => sync.refetch()}
        >
          <RefreshCw className={`size-4 ${sync.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </header>

      <div
        className={`mx-auto flex w-full max-w-7xl flex-col px-8 ${
          board ? "min-h-0 flex-1 gap-4 pt-6 pb-24" : "gap-7 pt-7 pb-28"
        }`}
      >
        <ActivityCard contributions={contributions} stats={stats} />
        <PrToolbar
          prs={openPrs}
          sort={sort}
          setSort={setSort}
          filter={filter}
          setFilter={setFilter}
          groupByRepo={groupByRepo}
          setGroupByRepo={setGroupByRepo}
          layout={layout}
          setLayout={setLayout}
        />
        {board ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-2 lg:grid-rows-2 lg:overflow-hidden">
            {sections}
          </div>
        ) : (
          sections
        )}
      </div>
    </main>
  );
}
