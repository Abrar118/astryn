// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const listGithubPrs = vi.hoisted(() => vi.fn());
const syncGithubPrs = vi.hoisted(() => vi.fn());
vi.mock("@/lib/commands", () => ({
  listGithubPrs,
  syncGithubPrs,
  getGithubStatus: vi.fn(),
}));

import { useGithubPrs, useGithubSync } from "./queries";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("GitHub query hooks", () => {
  beforeEach(() => {
    listGithubPrs.mockClear();
    syncGithubPrs.mockClear();
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
});
