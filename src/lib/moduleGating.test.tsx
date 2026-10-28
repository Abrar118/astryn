// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const active = vi.hoisted(() => ({ ids: new Set<string>() }));
const cmd = vi.hoisted(() => ({
  getMe: vi.fn(),
  listGithubPrs: vi.fn(),
  getSlackCatchup: vi.fn(),
  getTeamsCatchup: vi.fn(),
  syncTeamsCatchup: vi.fn(),
  syncGithubPrs: vi.fn(),
  syncIssues: vi.fn(),
  listDocsSources: vi.fn(),
  getDocsStatus: vi.fn(),
}));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/commands", () => ({
  ...cmd,
  errorText: (e: unknown) => (typeof e === "string" ? e : String(e)),
}));
vi.mock("@/lib/modules", () => ({
  useModules: () => ({ isActive: (id: string) => active.ids.has(id), hasCapability: () => true, ready: true }),
}));
vi.mock("goey-toast", () => ({ gooeyToast: { error: toastError, success: vi.fn() } }));

import { isModuleOff, useDocsSources, useDocsStatus, useGithubPrs, useGithubSync, useMe, useSlackCatchup, useSyncLoop, useTeamsCatchup, useTeamsSync } from "./queries";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  active.ids = new Set();
  Object.values(cmd).forEach((f) => f.mockReset());
  toastError.mockReset();
});

describe("owner gating", () => {
  it("never calls a guarded command while its module is off", async () => {
    renderHook(() => { useMe(); useGithubPrs(); useSlackCatchup(); useGithubSync(true); }, { wrapper });
    await act(async () => {});
    expect(cmd.getMe).not.toHaveBeenCalled();
    expect(cmd.listGithubPrs).not.toHaveBeenCalled();
    expect(cmd.getSlackCatchup).not.toHaveBeenCalled();
    expect(cmd.syncGithubPrs).not.toHaveBeenCalled();
  });

  it("gates the Teams board and sync on the teams module", async () => {
    active.ids = new Set(["slack"]);
    renderHook(() => { useTeamsCatchup(); useTeamsSync(true); }, { wrapper });
    await act(async () => {});
    expect(cmd.getTeamsCatchup).not.toHaveBeenCalled();
    expect(cmd.syncTeamsCatchup).not.toHaveBeenCalled();

    active.ids = new Set(["teams"]);
    cmd.getTeamsCatchup.mockResolvedValue({ conversations: [], mentions: [], threads: [], lastSyncedAt: null });
    cmd.syncTeamsCatchup.mockResolvedValue({ synced: true, conversationCount: 0, unreadTotal: 0 });
    renderHook(() => { useTeamsCatchup(); useTeamsSync(true); }, { wrapper });
    await waitFor(() => expect(cmd.syncTeamsCatchup).toHaveBeenCalled());
    expect(cmd.getTeamsCatchup).toHaveBeenCalled();
  });

  it("does not call the docs commands while docs is off", async () => {
    renderHook(() => { useDocsSources(); useDocsStatus(); }, { wrapper });
    await act(async () => {});
    expect(cmd.listDocsSources).not.toHaveBeenCalled();
    expect(cmd.getDocsStatus).not.toHaveBeenCalled();
  });

  it("runs the query once its owner is on", async () => {
    active.ids = new Set(["github"]);
    cmd.listGithubPrs.mockResolvedValue({ prs: [], meta: [] });
    renderHook(() => { useMe(); useGithubPrs(); }, { wrapper });
    await waitFor(() => expect(cmd.listGithubPrs).toHaveBeenCalled());
    expect(cmd.getMe).not.toHaveBeenCalled();
  });

  it("useSyncLoop(false) does not sync, even on refresh", async () => {
    const { result } = renderHook(() => useSyncLoop(false), { wrapper });
    act(() => result.current.refresh());
    await act(async () => {});
    expect(cmd.syncIssues).not.toHaveBeenCalled();
  });

  it("stays silent when the module is turned off mid-flight", async () => {
    active.ids = new Set(["github"]);
    cmd.syncGithubPrs.mockRejectedValue("That module is turned off.");
    renderHook(() => useGithubSync(true), { wrapper });
    await waitFor(() => expect(cmd.syncGithubPrs).toHaveBeenCalled());
    await act(async () => {});
    expect(toastError).not.toHaveBeenCalled();
    expect(isModuleOff("That module is turned off.")).toBe(true);
    expect(isModuleOff("boom")).toBe(false);
  });
});
