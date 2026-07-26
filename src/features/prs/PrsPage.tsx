import { useState } from "react";
import {
  Eye,
  GitMerge,
  GitPullRequest,
  MessageSquareWarning,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { gooeyToast } from "goey-toast";
import { Button } from "@/components/ui/button";
import {
  errorText,
  setGithubRepoFavorite,
  type Contributions,
  type GithubPr,
} from "@/lib/commands";
import {
  useGithubContributions,
  useGithubContributionsSync,
  useGithubPrs,
  useGithubStatus,
  useGithubSync,
} from "@/lib/queries";
import { useWorkspace } from "@/lib/tabs";
import { PrHeatMap } from "./PrHeatMap";
import { PrContextMenu } from "./PrContextMenu";
import { PrListPanel } from "./PrListPanel";
import { PrSidebar } from "./PrSidebar";
import { PrToolbar, type PrFilter } from "./PrToolbar";
import { contributionsToWeeks, prStats, type PrStats } from "./prActivity";
import { PR_SORTS, type PrSort } from "./prDisplay";
import {
  isRepositoryScope,
  loadGroupByRepo,
  repoScope,
  saveGroupByRepo,
  scopePrs,
  type ActivePrScope,
} from "./prScopes";

type ScopePresentation = { title: string; empty: string };

const PRIMARY_PRESENTATION: Record<
  Exclude<ActivePrScope, `repo:${string}`>,
  ScopePresentation
> = {
  mine: { title: "My PRs", empty: "You have no open pull requests." },
  assigned: { title: "Assigned to Me", empty: "No pull requests are assigned to you." },
  needs_review: {
    title: "Needs My Review",
    empty: "Nothing is waiting for your review.",
  },
};

const METRICS: {
  key: keyof PrStats;
  label: string;
  icon: LucideIcon;
  tint: string;
}[] = [
  { key: "open", label: "Open", icon: GitPullRequest, tint: "text-foreground" },
  { key: "needsReview", label: "Needs review", icon: Eye, tint: "text-indigo-400" },
  {
    key: "changesRequested",
    label: "Changes req.",
    icon: MessageSquareWarning,
    tint: "text-amber-400",
  },
  { key: "conflicts", label: "Conflicts", icon: GitMerge, tint: "text-red-400" },
];

function applyControls(
  list: GithubPr[],
  sort: PrSort,
  filter: PrFilter,
): GithubPr[] {
  let result = list;
  if (filter === "conflicts") {
    result = result.filter((pr) => pr.mergeable === "conflicting");
  } else if (filter === "ci_failing") {
    result = result.filter((pr) => pr.ciStatus === "failure");
  }
  return [...result].sort(PR_SORTS[sort]);
}

function ActivityCard({
  contributions,
  stats,
}: {
  contributions: Contributions | null | undefined;
  stats: PrStats;
}) {
  const weeks = contributionsToWeeks(contributions);
  return (
    <section className="rounded-xl border border-border/60 bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Activity
            </p>
            <p className="text-[11px] text-muted-foreground">
              {(contributions?.total ?? 0).toLocaleString()} contributions · last year
            </p>
          </div>
          <PrHeatMap weeks={weeks} />
        </div>
        <div className="grid shrink-0 grid-cols-4 divide-x divide-border/60 rounded-lg border border-border/50 bg-background/35 xl:w-[430px]">
          {METRICS.map(({ key, label, icon: Icon, tint }) => (
            <div key={key} className="flex min-w-0 items-center gap-2 px-3 py-2">
              <Icon className={`size-3.5 shrink-0 ${tint}`} />
              <div className="min-w-0">
                <p className="text-lg font-semibold leading-none tabular-nums text-foreground">
                  {stats[key]}
                </p>
                <p className="mt-1 truncate text-[10px] text-muted-foreground">{label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function scopePresentation(
  scope: ActivePrScope,
  favorites: string[],
): ScopePresentation {
  if (!isRepositoryScope(scope)) return PRIMARY_PRESENTATION[scope];
  const normalized = scope.slice("repo:".length);
  const repo =
    favorites.find((favorite) => favorite.toLowerCase() === normalized) ?? normalized;
  return {
    title: repo,
    empty: `No open pull requests are cached for ${repo}.`,
  };
}

export function PrsPage() {
  const { setActiveView } = useWorkspace();
  const { data: status } = useGithubStatus();
  const connected = status?.state === "connected" || status?.state === "unverified";
  const { data: dashboard } = useGithubPrs();
  const { data: contributions } = useGithubContributions();
  const sync = useGithubSync(connected);
  useGithubContributionsSync(connected);

  const [activeScope, setActiveScope] = useState<ActivePrScope>("mine");
  const [sort, setSort] = useState<PrSort>("updated");
  const [filter, setFilter] = useState<PrFilter>("all");
  const [groupByRepo, setGroupByRepoState] = useState(loadGroupByRepo);
  const [menu, setMenu] = useState<{
    pr: GithubPr;
    x: number;
    y: number;
    origin: HTMLElement;
  } | null>(null);

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
  const favorites = dashboard?.favoriteRepos ?? [];
  const openPrs = allPrs.filter((pr) => pr.bucket !== "merged");
  const activePrs = applyControls(scopePrs(openPrs, activeScope), sort, filter);
  const presentation = scopePresentation(activeScope, favorites);
  const failed = new Set(
    (sync.data ?? []).filter((result) => !result.ok).map((result) => result.bucket),
  );
  const viewerLogin = status?.state === "connected" ? status.login : null;

  const setGroupByRepo = (value: boolean) => {
    setGroupByRepoState(value);
    saveGroupByRepo(value);
  };

  const changeFavorite = async (repo: string, favorite: boolean) => {
    try {
      await setGithubRepoFavorite(repo, favorite);
      if (favorite) {
        setActiveScope(repoScope(repo));
      } else if (activeScope === repoScope(repo)) {
        setActiveScope("mine");
      }
      gooeyToast.success(
        favorite ? `Favorited ${repo}` : `Removed ${repo} from favorites`,
      );
      await sync.refetch();
    } catch (err) {
      gooeyToast.error("Couldn't update favorite repositories", {
        description: errorText(err),
      });
    }
  };

  const closeMenu = () => {
    const origin = menu?.origin;
    setMenu(null);
    origin?.focus();
  };

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-background/80 px-5 py-3 backdrop-blur">
        <div className="flex items-baseline gap-2">
          <h1 className="text-base font-semibold text-foreground">Pull Requests</h1>
          {status?.state === "connected" && (
            <span className="text-xs text-muted-foreground">@{status.login}</span>
          )}
          {sync.isError && (
            <span className="text-xs text-amber-400">
              Sync failed — showing cached data.
            </span>
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

      <div className="flex min-h-0 flex-1">
        <PrSidebar
          prs={openPrs}
          favorites={favorites}
          activeScope={activeScope}
          onSelect={setActiveScope}
          onFavoriteChange={changeFavorite}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4">
          <ActivityCard contributions={contributions} stats={prStats(openPrs)} />
          <PrToolbar
            prs={openPrs}
            sort={sort}
            setSort={setSort}
            filter={filter}
            setFilter={setFilter}
            groupByRepo={groupByRepo}
            setGroupByRepo={setGroupByRepo}
          />
          <PrListPanel
            title={presentation.title}
            empty={presentation.empty}
            prs={activePrs}
            meta={dashboard?.meta.find((item) => item.bucket === activeScope)}
            stale={failed.has(activeScope)}
            viewerLogin={viewerLogin}
            groupByRepo={groupByRepo}
            onOpenMenu={(pr, point, origin) =>
              setMenu({ pr, x: point.x, y: point.y, origin })
            }
          />
        </div>
      </div>
      {menu && (
        <PrContextMenu
          pr={menu.pr}
          favorite={favorites.some(
            (repo) => repo.toLowerCase() === menu.pr.repo.toLowerCase(),
          )}
          x={menu.x}
          y={menu.y}
          onFavoriteChange={changeFavorite}
          onClose={closeMenu}
        />
      )}
    </main>
  );
}
