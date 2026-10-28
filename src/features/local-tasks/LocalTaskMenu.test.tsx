// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { LocalTask } from "@/lib/commands";

const update = vi.hoisted(() => vi.fn());
const del = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", () => ({ useSearchParams: () => [new URLSearchParams(), vi.fn()] }));
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ openIssueTab: vi.fn(), openIssueInRightSplit: vi.fn() }) }));
vi.mock("@/lib/taskQueries", () => ({ useUpdateTask: () => ({ mutate: update }), useDeleteTask: () => ({ mutate: del }) }));
vi.mock("@/lib/localTaskQueries", () => ({
  useLocalTree: () => ({
    data: {
      spaces: [{ id: "lt_s", name: "S", position: 0 }],
      lists: [{ id: "lt_l", spaceId: "lt_s", name: "L", key: "L", position: 0 }],
      statuses: [
        { id: "todo", scopeId: "lt_s", name: "To do", category: "unstarted", color: "#999999", position: 0 },
        { id: "doing", scopeId: "lt_s", name: "Doing", category: "started", color: "#d99a2b", position: 1 },
      ],
      sprints: [],
      labels: [],
    },
  }),
}));

import { LocalTaskMenu } from "./LocalTaskMenu";

const task = {
  id: "lt_1", identifier: "L-1", title: "One", stateId: "todo", stateType: "unstarted", stateColor: "#999999",
  teamId: "lt_l", priority: 0, assigneeId: null,
} as LocalTask;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LocalTaskMenu", () => {
  it("changes status from the list's workflow", () => {
    const onClose = vi.fn();
    render(<LocalTaskMenu task={task} x={10} y={10} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Status/ }));
    fireEvent.click(screen.getByRole("button", { name: "Doing" }));
    expect(update).toHaveBeenCalledWith({ id: "lt_1", patch: { stateId: "doing" } });
    expect(onClose).toHaveBeenCalled();
  });

  it("asks once more before deleting", () => {
    render(<LocalTaskMenu task={task} x={10} y={10} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Delete task/ }));
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Confirm delete/ }));
    expect(del).toHaveBeenCalledWith("lt_1", expect.anything());
  });

  it("assigns the task to me", () => {
    render(<LocalTaskMenu task={task} x={10} y={10} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Assign to me/ }));
    expect(update).toHaveBeenCalledWith({ id: "lt_1", patch: { assigneeId: "lt_me" } });
  });
});
