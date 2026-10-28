import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import {
  errorText,
  getBitbucketPrDetail,
  getBitbucketPrDiff,
  getBitbucketStatus,
  listBitbucketPrs,
  listBitbucketRepositories,
  setBitbucketRepoFavorite,
  syncBitbucketPrs,
} from "./commands";
import { useModules } from "./modules";
import { isModuleOff } from "./queries";

/** Bitbucket mirrors of the GitHub PR hooks, keyed `bitbucket-*` and gated on the module. */

export function useBitbucketStatus() {
  return useQuery({ queryKey: ["bitbucket-status"], queryFn: getBitbucketStatus });
}

export function useBitbucketPrs() {
  const on = useModules().isActive("bitbucket");
  return useQuery({ queryKey: ["bitbucket-prs"], queryFn: listBitbucketPrs, enabled: on });
}

export function useBitbucketRepositories(enabled: boolean) {
  const on = useModules().isActive("bitbucket");
  return useQuery({
    queryKey: ["bitbucket-repositories"],
    queryFn: listBitbucketRepositories,
    enabled: enabled && on,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useBitbucketPrDetail(repo: string | null, number: number | null) {
  const on = useModules().isActive("bitbucket");
  return useQuery({
    queryKey: ["bitbucket-pr-detail", repo, number],
    enabled: on && repo !== null && number !== null,
    queryFn: () => getBitbucketPrDetail(repo!, number!),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** Lazy: the diff downloads only once the Diff tab is selected. */
export function useBitbucketPrDiff(repo: string | null, number: number | null, enabled: boolean) {
  const on = useModules().isActive("bitbucket");
  return useQuery({
    queryKey: ["bitbucket-pr-diff", repo, number],
    enabled: on && enabled && repo !== null && number !== null,
    queryFn: () => getBitbucketPrDiff(repo!, number!),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useSetBitbucketRepoFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repo, favorite }: { repo: string; favorite: boolean }) =>
      setBitbucketRepoFavorite(repo, favorite),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["bitbucket-prs"] });
    },
  });
}

/** Background sync on mount + every 5 minutes while credentials are present. */
export function useBitbucketSync(enabled: boolean) {
  const qc = useQueryClient();
  const on = useModules().isActive("bitbucket");
  return useQuery({
    queryKey: ["bitbucket-sync"],
    enabled: enabled && on,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        const results = await syncBitbucketPrs();
        await qc.invalidateQueries({ queryKey: ["bitbucket-prs"] });
        const failed = results.filter((result) => !result.ok);
        if (failed.length > 0) {
          gooeyToast.error("Some Bitbucket scopes couldn't refresh", {
            description: failed
              .map((r) => {
                const scope = r.bucket.replace(/^repo:/, "");
                return r.reason ? `${scope} — ${r.reason}` : scope;
              })
              .join(", "),
          });
        }
        return results;
      } catch (err) {
        if (!isModuleOff(err)) {
          gooeyToast.error("Couldn't refresh Bitbucket pull requests", { description: errorText(err) });
        }
        throw err;
      }
    },
  });
}

/** Drop every Bitbucket query after a credential change (the Rust cache was wiped). */
export function clearBitbucketQueries(qc: QueryClient) {
  for (const key of [
    ["bitbucket-status"],
    ["bitbucket-prs"],
    ["bitbucket-repositories"],
    ["bitbucket-pr-detail"],
    ["bitbucket-pr-diff"],
    ["bitbucket-sync"],
  ]) {
    qc.cancelQueries({ queryKey: key });
    qc.removeQueries({ queryKey: key });
  }
}
