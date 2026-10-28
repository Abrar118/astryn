// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("./LinearIssueDetail", () => ({ LinearIssueDetail: ({ id }: { id: string }) => <p>linear:{id}</p> }));
vi.mock("@/features/local-tasks/LocalTaskDetail", () => ({ LocalTaskDetail: ({ id }: { id: string }) => <p>local:{id}</p> }));

import { TaskDetail } from "./TaskDetail";

afterEach(cleanup);

describe("TaskDetail", () => {
  it("renders each tracker's own body", () => {
    render(<TaskDetail id="0b6c7c4e-uuid" mode="drawer" onClose={() => {}} />);
    expect(screen.getByText("linear:0b6c7c4e-uuid")).toBeTruthy();
    cleanup();
    render(<TaskDetail id="lt_abc" mode="page" onClose={() => {}} />);
    expect(screen.getByText("local:lt_abc")).toBeTruthy();
  });
});
