import { useEffect, useMemo, useRef, useState } from "react";
import {
  Eye,
  GitPullRequest,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Star,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { IndicatorLamp } from "@/components/IndicatorLamp";
import type { GithubPr } from "@/lib/commands";
import { useCodeHost } from "./codeHost";
import {
  knownRepos,
  repoScope,
  scopePrs,
  type ActivePrScope,
  type PrimaryPrScope,
} from "./prScopes";

type PrimaryItem = {
  scope: PrimaryPrScope;
  label: string;
  Icon: LucideIcon;
};

const PRIMARY_ITEMS: PrimaryItem[] = [
  { scope: "mine", label: "My PRs", Icon: GitPullRequest },
  { scope: "assigned", label: "Assigned to Me", Icon: UserCheck },
  { scope: "needs_review", label: "Needs My Review", Icon: Eye },
];

export function PrSidebar({
  prs,
  favorites,
  activeScope,
  onSelect,
  onFavoriteChange,
  staleScopes = new Set(),
  onRetry,
}: {
  prs: GithubPr[];
  favorites: string[];
  activeScope: ActivePrScope;
  onSelect: (scope: ActivePrScope) => void;
  onFavoriteChange: (repo: string, favorite: boolean) => void | Promise<void>;
  staleScopes?: ReadonlySet<string>;
  onRetry?: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);
  const host = useCodeHost();
  const repositoryQuery = host.useRepositories(pickerOpen);
  const primaryItems = PRIMARY_ITEMS.filter((item) => host.primaryScopes.includes(item.scope));
  const candidates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return knownRepos(
      prs,
      favorites,
      repositoryQuery.data?.repositories ?? [],
    ).filter((repo) => repo.toLowerCase().includes(normalized));
  }, [favorites, prs, query, repositoryQuery.data?.repositories]);

  useEffect(() => {
    if (!pickerOpen) return;
    const closePicker = () => {
      setPickerOpen(false);
      setQuery("");
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (
        pickerRef.current?.contains(event.target) ||
        pickerTriggerRef.current?.contains(event.target)
      ) {
        return;
      }
      closePicker();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePicker();
      pickerTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [pickerOpen]);

  const chooseFavorite = (repo: string) => {
    void onFavoriteChange(repo, true);
    setPickerOpen(false);
    setQuery("");
  };

  return (
    <aside className="relative flex w-14 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-1.5 py-3 lg:w-52 lg:px-2">
      <nav aria-label="Pull request queues" className="space-y-0.5">
        {primaryItems.map(({ scope, label, Icon }) => {
          const active = activeScope === scope;
          return (
            <button
              key={scope}
              type="button"
              aria-label={label}
              aria-current={active ? "page" : undefined}
              title={label}
              onClick={() => onSelect(scope)}
              className={`dash-control flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors ${
                active
                  ? "bg-card text-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              }`}
            >
              <Icon aria-hidden className={`size-4 shrink-0 ${active ? "text-primary" : ""}`} />
              <span className="hidden min-w-0 flex-1 truncate text-left lg:block">
                {label}
              </span>
              <span className="hidden text-[12px] tabular-nums text-muted-foreground lg:block">
                {scopePrs(prs, scope).length}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mt-5 flex items-center justify-center lg:justify-between lg:pl-2.5">
        <span className="hidden text-[12px] font-medium text-muted-foreground lg:block">
          favorite repositories
        </span>
        <button
          ref={pickerTriggerRef}
          type="button"
          aria-label="Add favorite repository"
          aria-expanded={pickerOpen}
          title="Add favorite repository"
          onClick={() =>
            setPickerOpen((open) => {
              if (open) setQuery("");
              return !open;
            })
          }
          className="dash-control flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <Plus aria-hidden className="size-3.5" />
        </button>
      </div>

      {pickerOpen && (
        <div
          ref={pickerRef}
          role="dialog"
          aria-label="Favorite repository search"
          className="absolute left-12 top-40 z-40 w-64 rounded-lg border border-border bg-popover p-1.5 shadow-[0_4px_16px_var(--overlay-shadow)] lg:left-2 lg:top-40"
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
            <Input
              autoFocus
              type="search"
              role="searchbox"
              aria-label="Search repositories"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a repository"
              className="pl-8"
            />
          </div>
          <div className="mt-1 max-h-52 overflow-y-auto">
            {repositoryQuery.isLoading && (
              <div
                role="status"
                className="flex items-center gap-2 px-2 py-2 text-[12px] text-muted-foreground"
              >
                <LoaderCircle className="size-3.5 animate-spin" />
                Loading repositories…
              </div>
            )}
            {repositoryQuery.isError && (
              <div
                role="alert"
                className="flex items-center gap-2 border-b border-border px-2 py-2 text-[12px] text-foreground"
              >
                <IndicatorLamp tone="warning" />
                <span className="min-w-0 flex-1">
                  Couldn't load all repositories.
                </span>
                <button
                  type="button"
                  aria-label="Retry repositories"
                  onClick={() => void repositoryQuery.refetch()}
                  className="dash-control flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <RefreshCw className="size-3.5" />
                </button>
              </div>
            )}
            {repositoryQuery.data?.truncated && (
              <p className="px-2 py-2 text-[12px] text-warning">
                Showing the first 10,000 accessible repositories.
              </p>
            )}
            {candidates.length === 0 && !repositoryQuery.isLoading ? (
              <p className="px-2 py-3 text-[12px] text-muted-foreground">
                No repositories available.
              </p>
            ) : (
              candidates.map((repo) => (
                <button
                  key={repo}
                  type="button"
                  aria-label={repo}
                  onClick={() => chooseFavorite(repo)}
                  className="dash-control flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground hover:bg-accent"
                >
                  <Star aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-[12px]">{repo}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className="mt-1 space-y-0.5">
        {favorites.map((repo) => {
          const scope = repoScope(repo);
          const active = activeScope === scope;
          const stale = staleScopes.has(scope);
          return (
            <div key={repo} className="group/favorite relative">
              <button
                type="button"
                aria-label={repo}
                aria-current={active ? "page" : undefined}
                title={stale ? `${repo} — refresh failed` : repo}
                onClick={() => onSelect(scope)}
                className={`dash-control flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors ${
                  active
                    ? "bg-card text-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                }`}
              >
                <Star
                  aria-hidden
                  className={`size-4 shrink-0 ${
                    stale
                      ? "text-warning"
                      : active
                        ? "fill-primary/25 text-primary"
                        : ""
                  }`}
                />
                <span className="hidden min-w-0 flex-1 truncate text-left lg:block">
                  {repo}
                </span>
                <span className="hidden text-[12px] tabular-nums text-muted-foreground group-focus-within/favorite:opacity-0 group-hover/favorite:opacity-0 lg:block">
                  {scopePrs(prs, scope).length}
                </span>
              </button>
              {stale && onRetry && (
                <button
                  type="button"
                  aria-label={`Retry ${repo}`}
                  title={`Retry ${repo}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRetry();
                  }}
                  className="dash-control absolute right-7 top-1 hidden size-6 items-center justify-center rounded-md text-warning hover:bg-sidebar-accent lg:flex"
                >
                  <RefreshCw className="size-3.5" />
                </button>
              )}
              <button
                type="button"
                aria-label={`Unfavorite ${repo}`}
                title={`Unfavorite ${repo}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void onFavoriteChange(repo, false);
                }}
                className="dash-control absolute right-1 top-1 hidden size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground group-hover/favorite:flex focus-visible:flex"
              >
                <Star className="size-3.5 fill-current" />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
