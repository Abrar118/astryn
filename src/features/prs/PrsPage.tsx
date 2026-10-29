import { SetupState } from "@/components/SetupState";
import { useState } from "react";
import { gooeyToast } from "goey-toast";
import {
  errorText,
  type Contributions,
  type GithubPr,
} from "@/lib/commands";
import { useWorkspace } from "@/lib/tabs";
import { cn } from "@/lib/utils";
import { IndicatorLamp, type Lamp } from "@/components/IndicatorLamp";
import { SyncHeader, syncLamp } from "@/components/SyncHeader";
import { requestSettingsSection } from "@/features/settings/settingsSection";
import { CodeHostContext, type CodeHostApi } from "./codeHost";
import { GITHUB_HOST } from "./githubHost";
import { PrHeatMap } from "./PrHeatMap";
import { PrContextMenu } from "./PrContextMenu";
import { PrDrawer } from "./PrDrawer";
import { PrListPanel } from "./PrListPanel";
import { PrSidebar } from "./PrSidebar";
import { PrToolbar, type PrFilter } from "./PrToolbar";
import { contributionsToWeeks, prStats } from "./prActivity";
import { PR_SORTS, waitingLabel, type PrSort } from "./prDisplay";
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

/** How long the longest-waiting review request has sat, coloured as it escalates. */
function oldestReviewWait(prs: GithubPr[]): { text: string; className: string } | null {
  const oldest = prs
    .filter((p) => p.bucket === "needs_review" && p.updatedAt)
    .sort((a, b) => Date.parse(a.updatedAt ?? "") - Date.parse(b.updatedAt ?? ""))[0];
  const wait = oldest ? waitingLabel(oldest.updatedAt, Date.now()) : null;
  if (!oldest || !wait) return null;
  return {
    text: `oldest #${oldest.number} · ${wait.short}`,
    className: wait.level === "stale" ? "text-destructive" : wait.level === "warn" ? "text-warning" : "text-muted-foreground",
  };
}

type Reading = { key: string; label: string; value: number; tone: Lamp; alarm?: boolean; detail?: { text: string; className: string } };

/** The faceplate's top zone: one reading per thing that can need you, and GitHub's contribution year. */
function ReadoutZone({
  prs,
  contributions,
}: {
  prs: GithubPr[];
  /** `undefined` when the provider has no contribution calendar. */
  contributions?: Contributions | null;
}) {
  const stats = prStats(prs);
  const oldestWait = oldestReviewWait(prs);
  const readings: Reading[] = [
    {
      key: "review",
      label: "needs review",
      value: stats.needsReview,
      tone: stats.needsReview ? "neutral" : "off",
      detail: oldestWait ?? undefined,
    },
    { key: "changes", label: "changes requested", value: stats.changesRequested, tone: stats.changesRequested ? "warning" : "off" },
    { key: "conflicts", label: "conflicts", value: stats.conflicts, tone: stats.conflicts ? "danger" : "off", alarm: true },
    { key: "ci", label: "ci failing", value: stats.ciFailing, tone: stats.ciFailing ? "danger" : "off", alarm: true },
  ];
  const heatmap = contributions !== undefined;
  return (
    <div className="dash-zone @container">
      <div className="flex flex-col @5xl:flex-row">
        <ul aria-label="Counts" className="prs-readings dash-readouts @5xl:shrink-0">
          {readings.map((r) => (
            <li key={r.key} className="min-w-0">
              <div className="prs-reading">
                <span className={cn("dash-numeral text-[28px]", r.alarm && r.value ? "text-destructive" : r.value ? "text-foreground" : "text-muted-foreground")}>
                  {r.value}
                </span>
                <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <IndicatorLamp tone={r.tone} />
                  {r.label}
                </span>
                {r.detail && <span className={cn("text-[12px] tabular-nums", r.detail.className)}>{r.detail.text}</span>}
              </div>
            </li>
          ))}
        </ul>
        {heatmap && (
          <div className="hidden min-w-0 flex-1 border-t border-border px-4 pt-3 pb-3 @3xl:block @5xl:border-t-0 @5xl:border-l">
            <div className="max-w-[760px]">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="text-[13px] font-semibold tracking-tight text-foreground">Activity</h2>
              <p className="text-[12px] tabular-nums text-muted-foreground">
                {(contributions?.total ?? 0).toLocaleString()} contributions · last year
              </p>
            </div>
            <PrHeatMap weeks={contributionsToWeeks(contributions)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function scopePresentation(
  scope: ActivePrScope,
  favorites: string[],
  host: CodeHostApi,
): ScopePresentation {
  if (!isRepositoryScope(scope)) {
    const base = PRIMARY_PRESENTATION[scope];
    return { ...base, empty: host.emptyCopy?.[scope] ?? base.empty };
  }
  const normalized = scope.slice("repo:".length);
  const repo =
    favorites.find((favorite) => favorite.toLowerCase() === normalized) ?? normalized;
  return {
    title: repo,
    empty: `No open pull requests are cached for ${repo}.`,
  };
}

/**
 * The PR workspace for one code host (GitHub unless told otherwise). Keyed by
 * host: a tab switched between providers keeps its position in the tree, and
 * the hosts call different hooks and must not share state.
 */
export function PrsPage({ host = GITHUB_HOST }: { host?: CodeHostApi }) {
  return (
    <CodeHostContext.Provider value={host}>
      <PrWorkspace key={host.id} host={host} />
    </CodeHostContext.Provider>
  );
}

function PrWorkspace({ host }: { host: CodeHostApi }) {
  const { setActiveView } = useWorkspace();
  const { data: status } = host.useStatus();
  const connected = status?.state === "connected" || status?.state === "unverified";
  const { data: dashboard } = host.usePrs();
  const contributions = host.contributions?.use().data;
  const sync = host.useSync(connected);
  const favoriteMutation = host.useSetFavorite();
  host.contributions?.useSync(connected);

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
  const [selectedPr, setSelectedPr] = useState<{
    pr: GithubPr;
    origin: HTMLElement;
  } | null>(null);

  if (status?.state === "not_configured") {
    return (
      <SetupState
        title={host.title}
        message={`Link your ${host.name} account to see your pull requests.`}
        action={`Connect ${host.name}`}
        onAction={() => {
          requestSettingsSection(host.settingsSection);
          setActiveView("settings");
        }}
      />
    );
  }

  const allPrs = dashboard?.prs ?? [];
  const favorites = dashboard?.favoriteRepos ?? [];
  const openPrs = allPrs.filter((pr) => pr.bucket !== "merged");
  const activePrs = applyControls(scopePrs(openPrs, activeScope), sort, filter);
  const presentation = scopePresentation(activeScope, favorites, host);
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
      await favoriteMutation.mutateAsync({ repo, favorite });
      if (favorite) {
        setActiveScope(repoScope(repo));
      } else if (activeScope === repoScope(repo)) {
        setActiveScope("mine");
      }
      gooeyToast.success(
        favorite ? `Favorited ${repo}` : `Removed ${repo} from favorites`,
      );
      void sync.refetch();
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
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <SyncHeader
        title={host.title}
        status={syncLamp({
          state: status?.state,
          syncFailed: sync.isError,
          connectedDetail: viewerLogin ? `${host.name.toLowerCase()} · @${viewerLogin}` : host.name.toLowerCase(),
        })}
        refreshing={sync.isFetching}
        onRefresh={() => void sync.refetch()}
      />

      <div className="flex min-h-0 flex-1">
        <PrSidebar
          prs={openPrs}
          favorites={favorites}
          activeScope={activeScope}
          onSelect={setActiveScope}
          onFavoriteChange={changeFavorite}
          staleScopes={failed}
          onRetry={() => void sync.refetch()}
        />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden p-4">
          <section aria-label="Pull requests" className="dash-panel dash-face isolate flex min-h-0 flex-1 flex-col overflow-hidden">
            <ReadoutZone
              prs={openPrs}
              contributions={host.contributions ? (contributions ?? null) : undefined}
            />
            <PrListPanel
              title={presentation.title}
              empty={presentation.empty}
              prs={activePrs}
              meta={dashboard?.meta.find((item) => item.bucket === activeScope)}
              stale={failed.has(activeScope)}
              viewerLogin={viewerLogin}
              groupByRepo={groupByRepo}
              controls={
                <PrToolbar
                  sort={sort}
                  setSort={setSort}
                  filter={filter}
                  setFilter={setFilter}
                  groupByRepo={groupByRepo}
                  setGroupByRepo={setGroupByRepo}
                />
              }
              onOpenPr={(pr, origin) => setSelectedPr({ pr, origin })}
              onOpenMenu={(pr, point, origin) =>
                setMenu({ pr, x: point.x, y: point.y, origin })
              }
            />
          </section>
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
      {selectedPr && (
        <PrDrawer
          pr={selectedPr.pr}
          favorite={favorites.some(
            (repo) => repo.toLowerCase() === selectedPr.pr.repo.toLowerCase(),
          )}
          onFavoriteChange={changeFavorite}
          onClose={() => setSelectedPr(null)}
          returnFocus={selectedPr.origin}
        />
      )}
    </main>
  );
}
