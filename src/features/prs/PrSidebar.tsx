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
import type { GithubPr } from "@/lib/commands";
import { useGithubRepositories } from "@/lib/queries";
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
  const repositoryQuery = useGithubRepositories(pickerOpen);
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
    <aside className="relative flex w-14 shrink-0 flex-col border-r border-border/60 bg-card/35 px-1.5 py-3 lg:w-52 lg:px-2.5">
      <nav aria-label="Pull request queues" className="space-y-1">
        {PRIMARY_ITEMS.map(({ scope, label, Icon }) => {
          const active = activeScope === scope;
          return (
            <button
              key={scope}
              type="button"
              aria-label={label}
              aria-current={active ? "page" : undefined}
              title={label}
              onClick={() => onSelect(scope)}
              className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors ${
                active
                  ? "bg-primary/12 text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              <Icon className={`size-4 shrink-0 ${active ? "text-primary" : ""}`} />
              <span className="hidden min-w-0 flex-1 truncate text-left lg:block">
                {label}
              </span>
              <span className="hidden min-w-5 rounded-md bg-background/60 px-1 text-center text-[11px] tabular-nums text-muted-foreground lg:block">
                {scopePrs(prs, scope).length}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mt-5 flex items-center justify-center px-1 lg:justify-between">
        <span className="hidden text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground lg:block">
          Favorite repositories
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
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {pickerOpen && (
        <div
          ref={pickerRef}
          role="dialog"
          aria-label="Favorite repository search"
          className="absolute left-12 top-40 z-40 w-64 rounded-xl border border-border bg-popover p-2 shadow-xl lg:left-3 lg:top-40"
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
                className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground"
              >
                <LoaderCircle className="size-3.5 animate-spin" />
                Loading repositories…
              </div>
            )}
            {repositoryQuery.isError && (
              <div
                role="alert"
                className="flex items-center gap-2 border-b border-border/60 px-2 py-2 text-xs text-amber-300"
              >
                <span className="min-w-0 flex-1">
                  Couldn't load all repositories.
                </span>
                <button
                  type="button"
                  aria-label="Retry repositories"
                  onClick={() => void repositoryQuery.refetch()}
                  className="flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted"
                >
                  <RefreshCw className="size-3.5" />
                </button>
              </div>
            )}
            {repositoryQuery.data?.truncated && (
              <p className="px-2 py-2 text-xs text-amber-300">
                Showing the first 10,000 accessible repositories.
              </p>
            )}
            {candidates.length === 0 && !repositoryQuery.isLoading ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                No repositories available.
              </p>
            ) : (
              candidates.map((repo) => (
                <button
                  key={repo}
                  type="button"
                  aria-label={repo}
                  onClick={() => chooseFavorite(repo)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-foreground hover:bg-muted"
                >
                  <Star className="size-3.5 text-muted-foreground" />
                  <span className="truncate">{repo}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className="mt-1 space-y-1">
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
                className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors ${
                  active
                    ? "bg-primary/12 text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                <Star
                  className={`size-4 shrink-0 ${
                    stale
                      ? "text-amber-400"
                      : active
                        ? "fill-primary/25 text-primary"
                        : ""
                  }`}
                />
                <span className="hidden min-w-0 flex-1 truncate text-left lg:block">
                  {repo}
                </span>
                <span className="hidden min-w-5 rounded-md bg-background/60 px-1 text-center text-[11px] tabular-nums text-muted-foreground group-hover/favorite:opacity-0 lg:block">
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
                  className="absolute right-8 top-1 hidden size-7 items-center justify-center rounded-md text-amber-400 hover:bg-muted hover:text-amber-300 lg:flex"
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
                className="absolute right-1 top-1 hidden size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground group-hover/favorite:flex focus:flex"
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
