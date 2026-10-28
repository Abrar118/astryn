import {
  useGithubContributions,
  useGithubContributionsSync,
  useGithubPrDetail,
  useGithubPrDiff,
  useGithubPrs,
  useGithubRepositories,
  useGithubStatus,
  useGithubSync,
  useSetGithubRepoFavorite,
} from "@/lib/queries";
import type { CodeHostApi } from "./codeHost";

// Hooks are wrapped so the bindings are read at call time, not at import.
export const GITHUB_HOST: CodeHostApi = {
  id: "github",
  name: "GitHub",
  title: "Pull Requests",
  settingsSection: "github",
  primaryScopes: ["mine", "assigned", "needs_review"],
  diffUrl: (url) => `${url.replace(/\/files\/?$/, "").replace(/\/$/, "")}/files`,
  useStatus: () => useGithubStatus(),
  usePrs: () => useGithubPrs(),
  useSync: (enabled) => useGithubSync(enabled),
  useSetFavorite: () => useSetGithubRepoFavorite(),
  useRepositories: (enabled) => useGithubRepositories(enabled),
  usePrDetail: (repo, number) => useGithubPrDetail(repo, number),
  usePrDiff: (repo, number, enabled) => useGithubPrDiff(repo, number, enabled),
  contributions: {
    use: () => useGithubContributions(),
    useSync: (enabled) => useGithubContributionsSync(enabled),
  },
};
