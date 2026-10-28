import { createContext, useContext } from "react";
import type {
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
import type { SettingsSection } from "@/features/settings/settingsSection";
import type { PrimaryPrScope } from "./prScopes";
import { GITHUB_HOST } from "./githubHost";

/**
 * One code-host provider as the PR workspace sees it: display copy plus the
 * provider's query hooks. The PR components are provider-neutral and read the
 * active host from `CodeHostContext`; payload shapes are shared, so only the
 * hooks and copy differ. Hosts call different sets of hooks (only GitHub has
 * `contributions`), so `PrsPage` remounts its workspace whenever the host
 * changes (`key={host.id}`); within one mount the host never changes.
 */
export type CodeHostApi = {
  id: "github" | "bitbucket";
  /** Provider name in copy: "Open on GitHub", "Connect Bitbucket". */
  name: string;
  /** Page heading. */
  title: string;
  settingsSection: SettingsSection;
  /** Viewer queues in siderail order. */
  primaryScopes: PrimaryPrScope[];
  /** The provider's web page for a pull request's full diff. */
  diffUrl: (pullRequestUrl: string) => string;
  /** Per-scope empty-state overrides. */
  emptyCopy?: Partial<Record<PrimaryPrScope, string>>;
  useStatus: typeof useGithubStatus;
  usePrs: typeof useGithubPrs;
  useSync: typeof useGithubSync;
  useSetFavorite: typeof useSetGithubRepoFavorite;
  useRepositories: typeof useGithubRepositories;
  usePrDetail: typeof useGithubPrDetail;
  usePrDiff: typeof useGithubPrDiff;
  /** Contribution heatmap; absent for providers without one. */
  contributions?: {
    use: typeof useGithubContributions;
    useSync: typeof useGithubContributionsSync;
  };
};

export const CodeHostContext = createContext<CodeHostApi>(GITHUB_HOST);

export function useCodeHost(): CodeHostApi {
  return useContext(CodeHostContext);
}
