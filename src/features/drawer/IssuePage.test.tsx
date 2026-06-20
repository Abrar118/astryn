// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { detail, closeTab } = vi.hoisted(() => ({ detail: { value: undefined as unknown }, closeTab: vi.fn() }));
vi.mock("@/lib/queries", () => ({ useIssueDetail: () => ({ data: detail.value }) }));
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ closeTab, active: { id: "tab-focused" } }) }));
vi.mock("./IssueDrawer", () => ({
  IssueDetail: ({ id, mode, onClose }: { id: string; mode: string; onClose: () => void }) => (
    <button data-testid="detail" onClick={onClose}>{`${mode}:${id}`}</button>
  ),
}));

import { IssuePage } from "./IssuePage";

afterEach(() => { cleanup(); detail.value = undefined; closeTab.mockReset(); });

describe("IssuePage", () => {
  it("shows a loading state until the detail resolves", () => {
    render(<IssuePage issueId="iss-1" tabId="tab-7" />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("renders IssueDetail in page mode once loaded", () => {
    detail.value = { source: "live", detail: {} };
    render(<IssuePage issueId="iss-1" tabId="tab-7" />);
    expect(screen.getByTestId("detail").textContent).toBe("page:iss-1");
  });

  it("closes its OWN tabId, not the focused tab", () => {
    detail.value = { source: "live", detail: {} };
    render(<IssuePage issueId="iss-1" tabId="tab-7" />);
    fireEvent.click(screen.getByTestId("detail"));
    expect(closeTab).toHaveBeenCalledWith("tab-7");
  });
});
