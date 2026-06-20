// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { detail } = vi.hoisted(() => ({ detail: { value: undefined as unknown } }));
vi.mock("@/lib/queries", () => ({ useIssueDetail: () => ({ data: detail.value }) }));
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ closeTab: vi.fn(), active: { id: "tab-1" } }) }));
vi.mock("./IssueDrawer", () => ({
  IssueDetail: ({ id, mode }: { id: string; mode: string }) => <div data-testid="detail">{`${mode}:${id}`}</div>,
}));

import { IssuePage } from "./IssuePage";

afterEach(() => { cleanup(); detail.value = undefined; });

describe("IssuePage", () => {
  it("shows a loading state until the detail resolves", () => {
    render(<IssuePage issueId="iss-1" />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("renders IssueDetail in page mode once loaded", () => {
    detail.value = { source: "live", detail: {} };
    render(<IssuePage issueId="iss-1" />);
    expect(screen.getByTestId("detail").textContent).toBe("page:iss-1");
  });
});
