// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("goey-toast", () => ({ gooeyToast: { error: vi.fn(), success: vi.fn() } }));

import { useSlackCatchup, useSlackSync } from "./queries";

afterEach(() => { cleanup(); invoke.mockReset(); });

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("slack queries", () => {
  it("useSlackCatchup reads the cache via get_slack_catchup", async () => {
    invoke.mockResolvedValueOnce({ conversations: [], mentions: [], threads: [], lastSyncedAt: null });
    const { result } = renderHook(() => useSlackCatchup(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invoke).toHaveBeenCalledWith("get_slack_catchup");
  });

  it("useSlackSync stays idle when disabled", async () => {
    const { result } = renderHook(() => useSlackSync(false), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(invoke).not.toHaveBeenCalledWith("sync_slack_catchup");
  });
});
