// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { detail, closeTab } = vi.hoisted(() => ({ detail: { value: undefined as unknown }, closeTab: vi.fn() }));
vi.mock("@/lib/queries", () => ({ useIssueDetail: () => ({ data: detail.value }) }));
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ closeTab, active: { id: "tab-focused" } }) }));
vi.mock("./IssueDrawer", () => ({
  IssueDetail: ({ id, mode, onClose }: { id: string; mode: string; onClose: () => void }) => (
    <button data-testid="detail" onClick={onClose}>{`${mode}:${id}`}</button>
  ),
}));

import { IssuePage } from "./IssuePage";

function renderPage() {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <IssuePage issueId="iss-1" tabId="tab-7" />
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); detail.value = undefined; closeTab.mockReset(); });

describe("IssuePage", () => {
  it("shows a loading state until the detail resolves", () => {
    renderPage();
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("renders the Linear issue detail in page mode for a Linear task", () => {
    detail.value = { source: "live", detail: {} };
    renderPage();
    expect(screen.getByTestId("detail").textContent).toBe("page:iss-1");
  });

  it("closes its OWN tabId, not the focused tab", () => {
    detail.value = { source: "live", detail: {} };
    renderPage();
    fireEvent.click(screen.getByTestId("detail"));
    expect(closeTab).toHaveBeenCalledWith("tab-7");
  });
});
