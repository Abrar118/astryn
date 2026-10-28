// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { LocalTask, LocalTree } from "@/lib/commands";

const setParams = vi.hoisted(() => vi.fn());
const createTask = vi.hoisted(() => vi.fn());
const updateTask = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ tree: undefined as LocalTree | undefined, tasks: [] as LocalTask[] }));

vi.mock("react-router-dom", () => ({ useSearchParams: () => [new URLSearchParams(), setParams] }));
vi.mock("@/features/issues/IssueContextMenu", () => ({ useIssueMenu: () => ({ openMenu: vi.fn() }) }));
vi.mock("@/lib/taskQueries", () => ({ useUpdateTask: () => ({ mutate: updateTask }) }));
vi.mock("@/lib/localTaskQueries", () => ({
  useLocalTree: () => ({ data: state.tree, isLoading: false, isError: false }),
  useLocalTasks: (f: { teamId?: string }) => ({
    data: f.teamId ? state.tasks.filter((t) => t.teamId === f.teamId) : state.tasks,
    isLoading: false,
  }),
  useCreateLocalTask: () => ({ mutate: createTask, isPending: false }),
  useCreateLocalSpace: () => ({ mutate: vi.fn() }),
  useCreateLocalList: () => ({ mutate: vi.fn() }),
  useRenameLocalSpace: () => ({ mutate: vi.fn() }),
  useDeleteLocalSpace: () => ({ mutate: vi.fn() }),
  useUpdateLocalList: () => ({ mutate: vi.fn() }),
  useDeleteLocalList: () => ({ mutate: vi.fn() }),
  useSetLocalStatuses: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { LocalTasksPage } from "./LocalTasksPage";

function task(id: string, over: Partial<LocalTask> = {}): LocalTask {
  return {
    id, identifier: `TASK-${id}`, title: `Task ${id}`, description: null, dueDate: null, startedAt: null, priority: 0,
    url: "", stateId: "todo", stateName: "To do", stateType: "unstarted", stateColor: "#999999", assigneeId: null,
    assigneeName: null, teamId: "lt_list", teamKey: "TASK", projectId: "lt_space", projectName: "Personal", parentId: null,
    estimate: null, cycleName: null, cycleNumber: null, milestoneName: null, linkCount: 0, prCount: 0,
    attachmentsTruncated: false, createdAt: "", updatedAt: "", labels: [], startDate: null, spaceId: "lt_space",
    sprintId: null, position: 1, listName: "Tasks", checklistDone: 0, checklistTotal: 0, ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  state.tree = {
    spaces: [{ id: "lt_space", name: "Personal", position: 0 }],
    lists: [{ id: "lt_list", spaceId: "lt_space", name: "Tasks", key: "TASK", position: 0 }],
    statuses: [
      { id: "todo", scopeId: "lt_space", name: "To do", category: "unstarted", color: "#999999", position: 0 },
      { id: "done", scopeId: "lt_space", name: "Done", category: "completed", color: "#4b9e6a", position: 1 },
    ],
    sprints: [],
    labels: [],
  };
  state.tasks = [task("lt_1"), task("lt_2", { stateId: "done", stateType: "completed", stateName: "Done" })];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LocalTasksPage", () => {
  it("opens the first list grouped by status and hides closed tasks by default", () => {
    render(<LocalTasksPage />);
    expect(screen.getByRole("heading", { name: /Personal \/\s*Tasks/ })).toBeTruthy();
    const todo = screen.getByRole("region", { name: "To do" });
    expect(within(todo).getByText("Task lt_1")).toBeTruthy();
    expect(screen.queryByText("Task lt_2")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show closed" }));
    expect(screen.getByText("Task lt_2")).toBeTruthy();
  });

  it("opens a task in the drawer", () => {
    render(<LocalTasksPage />);
    fireEvent.click(screen.getByText("Task lt_1"));
    expect(setParams).toHaveBeenCalledWith({ issue: "lt_1" });
  });

  it("adds a task with N into the first status of the list", () => {
    render(<LocalTasksPage />);
    fireEvent.keyDown(window, { key: "n" });
    const input = screen.getByRole("textbox", { name: "New task title" });
    fireEvent.change(input, { target: { value: "Write spec" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(createTask).toHaveBeenCalledWith(
      { listId: "lt_list", statusId: "todo", title: "Write spec" },
      expect.anything(),
    );
  });

  it("opens a board card with Enter instead of starting a keyboard drag", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    render(<LocalTasksPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    expect(screen.getByText(/Space picks it up/)).toBeTruthy();
    const card = screen.getByText("Task lt_1").closest("[role='button']") as HTMLElement;
    fireEvent.keyDown(card, { key: "Enter", code: "Enter" });
    expect(setParams).toHaveBeenCalledWith({ issue: "lt_1" });
  });

  it("switches views from the view switcher and remembers the choice", () => {
    render(<LocalTasksPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Table" }));
    expect(screen.getByRole("columnheader", { name: /Task/ })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("astryn.local-tasks.view") ?? "{}").view).toBe("table");
  });
});
