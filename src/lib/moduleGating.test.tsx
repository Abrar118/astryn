// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const active = vi.hoisted(() => ({ ids: new Set<string>(), screensOff: [] as string[] }));
const cmd = vi.hoisted(() => ({
  getMe: vi.fn(),
  listNotifications: vi.fn(),
  listGithubPrs: vi.fn(),
  getSlackCatchup: vi.fn(),
  syncGithubPrs: vi.fn(),
  syncIssues: vi.fn(),
  listDocsSources: vi.fn(),
  getDocsStatus: vi.fn(),
}));
const toastError = vi.hoisted(() => vi.fn());
const toastInfo = vi.hoisted(() => vi.fn());

vi.mock("@/lib/commands", () => ({
  ...cmd,
  errorText: (e: unknown) => (typeof e === "string" ? e : String(e)),
}));
vi.mock("@/lib/modules", async (orig) => ({
  ...(await orig<typeof import("./modules")>()),
  useModules: () => ({
    isActive: (id: string) => active.ids.has(id),
    hasCapability: () => true,
    disabledScreens: active.screensOff,
    ready: true,
  }),
}));
vi.mock("goey-toast", () => ({ gooeyToast: { error: toastError, info: toastInfo, success: vi.fn() } }));

import {
  isModuleOff,
  useDocsSources,
  useDocsStatus,
  useGithubPrs,
  useGithubSync,
  useMe,
  useNotifications,
  useSlackCatchup,
  useSyncLoop,
} from "./queries";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  active.ids = new Set();
  active.screensOff = [];
  Object.values(cmd).forEach((f) => f.mockReset());
  toastError.mockReset();
  toastInfo.mockReset();
});

describe("screen gating", () => {
  it("does not fetch notifications while Inbox is off, even with Linear on", async () => {
    active.ids = new Set(["linear"]);
    active.screensOff = ["inbox"];
    renderHook(() => useNotifications(), { wrapper });
    await act(async () => {});
    expect(cmd.listNotifications).not.toHaveBeenCalled();
  });

  it("fetches notifications while Inbox is on", async () => {
    active.ids = new Set(["linear"]);
    cmd.listNotifications.mockResolvedValue({ notifications: [] });
    renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(cmd.listNotifications).toHaveBeenCalled());
  });
});

describe("missing Linear key", () => {
  const NO_KEY = "No Linear key is configured.";

  it("background sync stays silent", async () => {
    cmd.syncIssues.mockRejectedValue(NO_KEY);
    renderHook(() => useSyncLoop(true), { wrapper });
    await waitFor(() => expect(cmd.syncIssues).toHaveBeenCalled());
    await act(async () => {});
    expect(toastError).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("a manual refresh points to Settings instead of reporting a failure", async () => {
    cmd.syncIssues.mockRejectedValue(NO_KEY);
    const { result } = renderHook(() => useSyncLoop(true), { wrapper });
    await waitFor(() => expect(cmd.syncIssues).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isSyncing).toBe(false));
    act(() => result.current.refresh());
    await waitFor(() => expect(toastInfo).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
    expect(String(toastInfo.mock.calls[0][0])).toMatch(/linear/i);
  });

  it("other sync errors still report Sync failed", async () => {
    cmd.syncIssues.mockRejectedValue("Could not reach Linear.");
    renderHook(() => useSyncLoop(true), { wrapper });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Sync failed", { description: "Could not reach Linear." }));
  });
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
