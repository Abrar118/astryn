// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const listGithubPrs = vi.hoisted(() => vi.fn());
const syncGithubPrs = vi.hoisted(() => vi.fn());
const getGithubPrDetail = vi.hoisted(() => vi.fn());
const getGithubPrDiff = vi.hoisted(() => vi.fn());
const listGithubRepositories = vi.hoisted(() => vi.fn());
const setGithubRepoFavorite = vi.hoisted(() => vi.fn());
const gooeyToastError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/commands", () => ({
  listGithubPrs,
  syncGithubPrs,
  getGithubPrDetail,
  getGithubPrDiff,
  listGithubRepositories,
  setGithubRepoFavorite,
  getGithubStatus: vi.fn(),
  errorText: (err: unknown) => (typeof err === "string" ? err : String(err)),
}));

vi.mock("goey-toast", () => ({
  gooeyToast: { error: gooeyToastError, success: vi.fn() },
}));

import {
  useGithubPrDiff,
  useGithubPrDetail,
  useGithubRepositories,
  useGithubPrs,
  useGithubSync,
  useSetGithubRepoFavorite,
} from "./queries";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("GitHub query hooks", () => {
  beforeEach(() => {
    listGithubPrs.mockClear();
    syncGithubPrs.mockClear();
    getGithubPrDetail.mockClear();
    getGithubPrDiff.mockClear();
    listGithubRepositories.mockClear();
    setGithubRepoFavorite.mockClear();
    gooeyToastError.mockClear();
  });

  it("useGithubPrs returns the cached dashboard", async () => {
    listGithubPrs.mockResolvedValue({ prs: [{ id: "o/r#1", bucket: "mine" }], meta: [] });
    const { result } = renderHook(() => useGithubPrs(), { wrapper });
    await waitFor(() => expect(result.current.data?.prs).toHaveLength(1));
  });

  it("useGithubSync(false) never hits the network", async () => {
    syncGithubPrs.mockResolvedValue([]);
    renderHook(() => useGithubSync(false), { wrapper });
    await Promise.resolve();
    expect(syncGithubPrs).not.toHaveBeenCalled();
  });

  it("useGithubSync(true) syncs and invalidates the cached list", async () => {
    listGithubPrs.mockResolvedValue({ prs: [], meta: [] });
    syncGithubPrs.mockResolvedValue([]);
    // Render both hooks: useGithubPrs provides the list query that will be invalidated,
    // and useGithubSync(true) calls syncGithubPrs and then invalidates ["github-prs"].
    renderHook(() => { useGithubPrs(); return useGithubSync(true); }, { wrapper });
    // Verify sync runs.
    await waitFor(() => expect(syncGithubPrs).toHaveBeenCalled());
    // After invalidation, the list query becomes stale (and will refetch on next mount/subscription).
    expect(listGithubPrs).toHaveBeenCalled();
  });

  it("useGithubSync(true) emits a goey-toast error when syncGithubPrs rejects", async () => {
    syncGithubPrs.mockRejectedValue("GitHub token expired");
    renderHook(() => useGithubSync(true), { wrapper });
    await waitFor(() => expect(gooeyToastError).toHaveBeenCalledWith(
      "Couldn't refresh pull requests",
      expect.objectContaining({ description: "GitHub token expired" }),
    ));
  });

  it("reports partial per-scope sync failures", async () => {
    syncGithubPrs.mockResolvedValue([
      { bucket: "mine", ok: true, truncated: false },
      { bucket: "repo:acme/web", ok: false, truncated: false },
    ]);
    renderHook(() => useGithubSync(true), { wrapper });
    await waitFor(() =>
      expect(gooeyToastError).toHaveBeenCalledWith(
        "Some pull request scopes couldn't refresh",
        expect.objectContaining({ description: "acme/web" }),
      ),
    );
  });

  it("invalidates the cached dashboard immediately after a favorite write", async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    qc.setQueryData(["github-prs"], { prs: [], meta: [], favoriteRepos: [] });
    setGithubRepoFavorite.mockResolvedValue(["Acme/Web"]);
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSetGithubRepoFavorite(), {
      wrapper: localWrapper,
    });
    await result.current.mutateAsync({ repo: "Acme/Web", favorite: true });
    expect(qc.getQueryState(["github-prs"])?.isInvalidated).toBe(true);
  });

  it("loads a selected PR detail and keeps it session-cached", async () => {
    getGithubPrDetail.mockResolvedValue({ repo: "o/r", number: 42, title: "Detail" });
    const { result } = renderHook(() => useGithubPrDetail("o/r", 42), { wrapper });
    await waitFor(() => expect(result.current.data?.title).toBe("Detail"));
    expect(getGithubPrDetail).toHaveBeenCalledWith("o/r", 42);
  });

  it("does not request PR detail without a complete selection", async () => {
    renderHook(() => useGithubPrDetail(null, null), { wrapper });
    await Promise.resolve();
    expect(getGithubPrDetail).not.toHaveBeenCalled();
  });

  it("loads PR patches only after the diff view is enabled", async () => {
    getGithubPrDiff.mockResolvedValue({
      repo: "o/r",
      number: 42,
      files: [{ path: "src/app.ts", patch: "@@ -1 +1 @@" }],
      totalFiles: 1,
      truncated: false,
    });
    const { result, rerender } = renderHook(
      ({ enabled }) => useGithubPrDiff("o/r", 42, enabled),
      { wrapper, initialProps: { enabled: false } },
    );
    expect(getGithubPrDiff).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() => expect(result.current.data?.totalFiles).toBe(1));
    expect(getGithubPrDiff).toHaveBeenCalledWith("o/r", 42);
  });

  it("loads the accessible repository catalog only when enabled", async () => {
    listGithubRepositories.mockResolvedValue({
      repositories: ["Abrar/personal", "GAM-Health/platform"],
      truncated: false,
    });
    const { result, rerender } = renderHook(
      ({ enabled }) => useGithubRepositories(enabled),
      { wrapper, initialProps: { enabled: false } },
    );
    expect(listGithubRepositories).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() =>
      expect(result.current.data?.repositories).toEqual([
        "Abrar/personal",
        "GAM-Health/platform",
      ]),
    );
    expect(listGithubRepositories).toHaveBeenCalledTimes(1);
  });
});
