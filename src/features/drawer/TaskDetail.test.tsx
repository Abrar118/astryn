// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const docsOn = vi.hoisted(() => ({ value: true }));

vi.mock("./LinearIssueDetail", () => ({
  LinearIssueDetail: ({ id, docLinks }: { id: string; docLinks?: ReactNode }) => (
    <div>
      <p>linear:{id}</p>
      {docLinks}
    </div>
  ),
}));
vi.mock("@/features/local-tasks/LocalTaskDetail", () => ({
  LocalTaskDetail: ({ id, docLinks }: { id: string; docLinks?: ReactNode }) => (
    <div>
      <p>local:{id}</p>
      {docLinks}
    </div>
  ),
}));
vi.mock("@/features/docs/DocLinksPanel", () => ({
  DocLinksPanel: ({ tracker, taskId }: { tracker: string; taskId: string }) => (
    <p>
      links:{tracker}:{taskId}
    </p>
  ),
}));
vi.mock("@/lib/modules", () => ({ useModules: () => ({ isActive: (id: string) => id === "docs" && docsOn.value }) }));

import { TaskDetail } from "./TaskDetail";

beforeEach(() => {
  docsOn.value = true;
});
afterEach(cleanup);

describe("TaskDetail", () => {
  it("renders each tracker's own body", () => {
    render(<TaskDetail id="0b6c7c4e-uuid" mode="drawer" onClose={() => {}} />);
    expect(screen.getByText("linear:0b6c7c4e-uuid")).toBeTruthy();
    cleanup();
    render(<TaskDetail id="lt_abc" mode="page" onClose={() => {}} />);
    expect(screen.getByText("local:lt_abc")).toBeTruthy();
  });

  it("gives every tracker's body the doc links of its own task", () => {
    render(<TaskDetail id="0b6c7c4e-uuid" mode="drawer" onClose={() => {}} />);
    expect(screen.getByText("links:linear:0b6c7c4e-uuid")).toBeTruthy();
    cleanup();
    render(<TaskDetail id="lt_abc" mode="page" onClose={() => {}} />);
    expect(screen.getByText("links:local-tasks:lt_abc")).toBeTruthy();
  });

  it("leaves doc links out while Docs is off", () => {
    docsOn.value = false;
    render(<TaskDetail id="lt_abc" mode="drawer" onClose={() => {}} />);
    expect(screen.queryByText(/^links:/)).toBeNull();
  });
});
