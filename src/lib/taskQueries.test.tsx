// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { IssueListItem } from "./commands";

const active = vi.hoisted(() => ({ ids: new Set<string>() }));
const cmd = vi.hoisted(() => ({
  getMe: vi.fn(),
  listIssues: vi.fn(),
  listCalendarIssues: vi.fn(),
  listUnscheduled: vi.fn(),
  listRelations: vi.fn(),
  listFilterOptions: vi.fn(),
  listWorkflowStates: vi.fn(),
  listUsers: vi.fn(),
  updateIssue: vi.fn(),
  deleteIssue: vi.fn(),
  createIssueRelation: vi.fn(),
  listLocalTasks: vi.fn(),
  updateLocalTask: vi.fn(),
}));

vi.mock("./commands", () => ({ ...cmd, errorText: (e: unknown) => String(e) }));
vi.mock("./modules", () => ({
  useModules: () => ({ isActive: (id: string) => active.ids.has(id), hasCapability: () => true, ready: true }),
}));
vi.mock("goey-toast", () => ({ gooeyToast: { error: vi.fn(), success: vi.fn() } }));

import { mergeResults, useTasks, useUpdateTask, useViewer } from "./taskQueries";
import { ME } from "./tracker";

function issue(id: string, extra: Partial<IssueListItem> = {}): IssueListItem {
  return {
    id, identifier: `ENG-${id}`, title: id, description: null, dueDate: null, startedAt: null, priority: 0, url: "",
    stateId: "s1", stateName: "Todo", stateType: "unstarted", stateColor: "#fff", assigneeId: "v1", assigneeName: "Me",
    teamId: "t1", teamKey: "ENG", projectId: null, projectName: null, parentId: null, estimate: null, cycleName: null,
    cycleNumber: null, milestoneName: null, linkCount: 0, prCount: 0, attachmentsTruncated: false,
    createdAt: "", updatedAt: "", labels: [], ...extra,
  };
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

afterEach(() => {
  cleanup();
  active.ids = new Set();
  Object.values(cmd).forEach((f) => f.mockReset());
});

describe("mergeResults", () => {
  it("is loading until every tracker has data or failed", () => {
    expect(mergeResults([{ data: [1], isError: false }, { data: undefined, isError: false }])).toEqual({
      data: undefined, isLoading: true, isError: false,
    });
  });

  it("keeps one tracker's data when another fails", () => {
    expect(mergeResults([{ data: [1, 2], isError: false }, { data: undefined, isError: true }])).toEqual({
      data: [1, 2], isLoading: false, isError: true,
    });
  });

  it("has no data when no tracker is active", () => {
    expect(mergeResults([])).toEqual({ data: undefined, isLoading: false, isError: false });
  });
});

describe("useTasks", () => {
  it("reads nothing while no tracker is on", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useTasks({}), { wrapper });
    await act(async () => {});
    expect(cmd.listIssues).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("resolves ME to the tracker's viewer and keys the cache per tracker", async () => {
    active.ids = new Set(["linear"]);
    cmd.getMe.mockResolvedValue({ viewerId: "v1", viewerName: "Me" });
    cmd.listIssues.mockResolvedValue([issue("1")]);
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useTasks({ assigneeId: ME }), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(cmd.listIssues).toHaveBeenCalledWith({ assigneeId: "v1" });
    expect(qc.getQueryData(["issues", "linear", { assigneeId: "v1" }])).toHaveLength(1);
  });
});

describe("two trackers", () => {
  it("merges Linear and local tasks, resolving ME per tracker", async () => {
    active.ids = new Set(["linear", "local-tasks"]);
    cmd.getMe.mockResolvedValue({ viewerId: "v1", viewerName: "Ada" });
    cmd.listIssues.mockResolvedValue([issue("1")]);
    cmd.listLocalTasks.mockResolvedValue([issue("lt_2", { assigneeId: "lt_me" })]);
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ tasks: useTasks({ assigneeId: ME }), viewer: useViewer() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.data?.map((t) => t.id)).toEqual(["1", "lt_2"]));
    expect(cmd.listLocalTasks).toHaveBeenCalledWith({ assigneeId: "lt_me" });
    expect(result.current.viewer.viewerIds).toEqual(["v1", "lt_me"]);
    expect(result.current.viewer.name).toBe("Ada");
  });

  it("keeps local tasks visible when Linear's cache read fails", async () => {
    active.ids = new Set(["linear", "local-tasks"]);
    cmd.listIssues.mockRejectedValue("Internal error.");
    cmd.listLocalTasks.mockResolvedValue([issue("lt_2")]);
    const { wrapper } = setup();
    const { result } = renderHook(() => useTasks({}), { wrapper });
    await waitFor(() => expect(result.current.data?.map((t) => t.id)).toEqual(["lt_2"]));
    expect(result.current.isError).toBe(true);
  });

  it("routes a local task update to the local tracker", async () => {
    active.ids = new Set(["linear", "local-tasks"]);
    cmd.updateLocalTask.mockResolvedValue(issue("lt_2"));
    const { qc, wrapper } = setup();
    qc.setQueryData(["issues", "local-tasks", {}], [issue("lt_2")]);
    const { result } = renderHook(() => useUpdateTask(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "lt_2", patch: { priority: 1 } });
    });
    await waitFor(() => expect(cmd.updateLocalTask).toHaveBeenCalledWith("lt_2", { priority: 1 }));
    expect(cmd.updateIssue).not.toHaveBeenCalled();
  });
});

describe("useViewer", () => {
  it("collects each active tracker's viewer id", async () => {
    active.ids = new Set(["linear"]);
    cmd.getMe.mockResolvedValue({ viewerId: "v1", viewerName: "Ada" });
    const { wrapper } = setup();
    const { result } = renderHook(() => useViewer(), { wrapper });
    await waitFor(() => expect(result.current.viewerIds).toEqual(["v1"]));
    expect(result.current.name).toBe("Ada");
  });
});

describe("useUpdateTask", () => {
  it("routes to the owning tracker and never inserts into another tracker's cache", async () => {
    active.ids = new Set(["linear"]);
    cmd.updateIssue.mockResolvedValue(issue("1"));
    const { qc, wrapper } = setup();
    qc.setQueryData(["issues", "linear", {}], [issue("1")]);
    qc.setQueryData(["issues", "other", {}], [issue("lt_9")]);
    qc.setQueryData(["calendar", "other", "2026-06-01", "2026-07-01", {}], []);
    const { result } = renderHook(() => useUpdateTask(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "1", patch: { dueDate: "2026-06-10", title: "Renamed" } });
    });
    await waitFor(() => expect(cmd.updateIssue).toHaveBeenCalledWith("1", { dueDate: "2026-06-10", title: "Renamed" }));
    expect(qc.getQueryData<IssueListItem[]>(["issues", "linear", {}])?.[0].title).toBe("Renamed");
    expect(qc.getQueryData<IssueListItem[]>(["issues", "other", {}])?.map((i) => i.id)).toEqual(["lt_9"]);
    expect(qc.getQueryData(["calendar", "other", "2026-06-01", "2026-07-01", {}])).toEqual([]);
  });
});
