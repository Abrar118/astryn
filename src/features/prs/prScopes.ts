import type { GithubPr, PrScope } from "@/lib/commands";

export type PrimaryPrScope = "mine" | "assigned" | "needs_review";
export type ActivePrScope = PrimaryPrScope | `repo:${string}`;

export const PR_GROUP_KEY = "astryn:prs:group-by-repo:v1";

export function repoScope(repo: string): `repo:${string}` {
  return `repo:${repo.trim().toLowerCase()}`;
}

export function scopePrs(prs: GithubPr[], scope: ActivePrScope): GithubPr[] {
  const seen = new Set<string>();
  return prs.filter((pr) => {
    if (pr.bucket !== scope || seen.has(pr.id)) return false;
    seen.add(pr.id);
    return true;
  });
}

export function knownRepos(
  prs: GithubPr[],
  favorites: string[],
  repositories: string[] = [],
): string[] {
  const excluded = new Set(favorites.map((repo) => repo.toLowerCase()));
  const repos = new Map<string, string>();
  for (const pr of prs) {
    const key = pr.repo.toLowerCase();
    if (!excluded.has(key) && !repos.has(key)) repos.set(key, pr.repo);
  }
  for (const repo of repositories) {
    const key = repo.toLowerCase();
    if (!excluded.has(key) && !repos.has(key)) repos.set(key, repo);
  }
  return [...repos.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

function defaultStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function loadGroupByRepo(storage: Storage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(PR_GROUP_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveGroupByRepo(
  value: boolean,
  storage: Storage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(PR_GROUP_KEY, String(value));
  } catch {
    // Preferences remain usable for the current session if storage is unavailable.
  }
}

export function isRepositoryScope(scope: PrScope): scope is `repo:${string}` {
  return scope.startsWith("repo:");
}
