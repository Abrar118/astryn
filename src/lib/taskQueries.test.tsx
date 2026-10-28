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
vi.mock("./modules", async (orig) => ({
  ...(await orig<typeof import("./modules")>()),
  useModules: () => ({ isActive: (id: string) => active.ids.has(id), hasCapability: () => true, ready: true }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("goey-toast", () => ({ gooeyToast: toast }));

import { mergeResults, useDeleteTask, useTaskUsers, useTasks, useUpdateTask, useViewer } from "./taskQueries";
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

  it("patches a local task's own detail cache, never the Linear-shaped one", async () => {
    active.ids = new Set(["local-tasks"]);
    cmd.updateLocalTask.mockReturnValue(new Promise(() => {}));
    const { qc, wrapper } = setup();
    const statuses = [{ id: "doing", scopeId: "lt_s", name: "Doing", category: "started", color: "#d99a2b", position: 1 }];
    qc.setQueryData(["local-task", "lt_2"], { ...issue("lt_2"), statuses });
    const { result } = renderHook(() => useUpdateTask(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "lt_2", patch: { stateId: "doing" } });
    });
    await waitFor(() =>
      expect(qc.getQueryData<IssueListItem>(["local-task", "lt_2"])).toMatchObject({ stateName: "Doing", stateType: "started" }),
    );
    expect(qc.getQueryData(["issue", "lt_2"])).toBeUndefined();
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

const JUNE = ["calendar", "linear", "2026-06-01", "2026-07-01", {}];
const JULY = ["calendar", "linear", "2026-07-01", "2026-08-01", {}];
const UNSCHEDULED = ["unscheduled", "linear", {}];

describe("useUpdateTask calendar reconcile", () => {
  it("moves a dragged task between month ranges and into the unscheduled rail", async () => {
    active.ids = new Set(["linear"]);
    cmd.updateIssue.mockReturnValue(new Promise(() => {}));
    const { qc, wrapper } = setup();
    qc.setQueryData(JUNE, [issue("1", { dueDate: "2026-06-10" })]);
    qc.setQueryData(JULY, []);
    qc.setQueryData(UNSCHEDULED, []);
    const { result } = renderHook(() => useUpdateTask(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "1", patch: { dueDate: "2026-07-05" } });
    });
    await waitFor(() => expect(qc.getQueryData<IssueListItem[]>(JULY)?.map((i) => i.dueDate)).toEqual(["2026-07-05"]));
    expect(qc.getQueryData(JUNE)).toEqual([]);
    await act(async () => {
      result.current.mutate({ id: "1", patch: { dueDate: null } });
    });
    await waitFor(() => expect(qc.getQueryData<IssueListItem[]>(UNSCHEDULED)?.map((i) => i.id)).toEqual(["1"]));
    expect(qc.getQueryData(JULY)).toEqual([]);
  });

  it("rolls every cache back and names the failure when the write fails", async () => {
    active.ids = new Set(["linear"]);
    toast.error.mockReset();
    cmd.updateIssue.mockRejectedValue("Linear rejected the request.");
    const { qc, wrapper } = setup();
    const june = [issue("1", { dueDate: "2026-06-10" })];
    qc.setQueryData(JUNE, june);
    qc.setQueryData(JULY, []);
    qc.setQueryData(["issue", "1"], { source: "cache", detail: issue("1", { dueDate: "2026-06-10" }) });
    const { result } = renderHook(() => useUpdateTask(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "1", patch: { dueDate: "2026-07-05" } });
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Update failed", { description: "Linear rejected the request." }));
    expect(qc.getQueryData(JUNE)).toEqual(june);
    expect(qc.getQueryData(JULY)).toEqual([]);
    expect((qc.getQueryData(["issue", "1"]) as { detail: IssueListItem }).detail.dueDate).toBe("2026-06-10");
  });
});

describe("useDeleteTask", () => {
  it("removes the task everywhere, then restores it if the delete fails", async () => {
    active.ids = new Set(["linear"]);
    toast.error.mockReset();
    let reject: (e: unknown) => void = () => {};
    cmd.deleteIssue.mockReturnValue(new Promise((_, r) => (reject = r)));
    const { qc, wrapper } = setup();
    qc.setQueryData(["issues", "linear", {}], [issue("1"), issue("2")]);
    qc.setQueryData(JUNE, [issue("1", { dueDate: "2026-06-10" })]);
    const { result } = renderHook(() => useDeleteTask(), { wrapper });
    await act(async () => {
      result.current.mutate("1");
    });
    await waitFor(() => expect(qc.getQueryData<IssueListItem[]>(["issues", "linear", {}])?.map((i) => i.id)).toEqual(["2"]));
    expect(qc.getQueryData(JUNE)).toEqual([]);
    await act(async () => reject("Linear rejected the request."));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Delete failed", expect.anything()));
    expect(qc.getQueryData<IssueListItem[]>(["issues", "linear", {}])?.map((i) => i.id)).toEqual(["1", "2"]);
  });

  it("routes the delete to the owning tracker and confirms it", async () => {
    active.ids = new Set(["linear"]);
    toast.success.mockReset();
    cmd.deleteIssue.mockResolvedValue(undefined);
    const { wrapper } = setup();
    const { result } = renderHook(() => useDeleteTask(), { wrapper });
    await act(async () => {
      result.current.mutate("1");
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Issue deleted"));
    expect(cmd.deleteIssue).toHaveBeenCalledWith("1");
  });
});

describe("ME without a known viewer", () => {
  it("falls back to every assignee instead of an empty screen", async () => {
    active.ids = new Set(["linear"]);
    cmd.getMe.mockResolvedValue(null);
    cmd.listIssues.mockResolvedValue([issue("1")]);
    const { wrapper } = setup();
    const { result } = renderHook(() => useTasks({ assigneeId: ME }), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(cmd.listIssues).toHaveBeenCalledWith({});
  });
});

describe("useTaskUsers", () => {
  it("tags users with their tracker without changing the shared cache", async () => {
    active.ids = new Set(["linear"]);
    cmd.listUsers.mockResolvedValue([{ id: "u1", name: "Ada" }]);
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useTaskUsers(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([{ id: "u1", name: "Ada", tracker: "linear" }]));
    expect(qc.getQueryData(["users", "linear"])).toEqual([{ id: "u1", name: "Ada" }]);
  });
});
