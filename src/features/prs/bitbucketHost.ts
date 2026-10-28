import {
  useBitbucketPrDetail,
  useBitbucketPrDiff,
  useBitbucketPrs,
  useBitbucketRepositories,
  useBitbucketStatus,
  useBitbucketSync,
  useSetBitbucketRepoFavorite,
} from "@/lib/bitbucketQueries";
import type { CodeHostApi } from "./codeHost";

/**
 * Bitbucket Cloud has no assignees and no cross-repository "review requested"
 * search: Needs My Review is derived (in Rust) from favorite repositories.
 */
export const BITBUCKET_HOST: CodeHostApi = {
  id: "bitbucket",
  name: "Bitbucket",
  title: "Bitbucket Pull Requests",
  settingsSection: "bitbucket",
  primaryScopes: ["mine", "needs_review"],
  diffUrl: (url) => `${url.replace(/\/diff\/?$/, "").replace(/\/$/, "")}/diff`,
  emptyCopy: {
    needs_review:
      "Nothing is waiting for your review in your favorite repositories. Favorite a repository to include it.",
  },
  useStatus: () => useBitbucketStatus(),
  usePrs: () => useBitbucketPrs(),
  useSync: (enabled) => useBitbucketSync(enabled),
  useSetFavorite: () => useSetBitbucketRepoFavorite(),
  useRepositories: (enabled) => useBitbucketRepositories(enabled),
  usePrDetail: (repo, number) => useBitbucketPrDetail(repo, number),
  usePrDiff: (repo, number, enabled) => useBitbucketPrDiff(repo, number, enabled),
};
