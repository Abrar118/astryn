// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const ws = vi.hoisted(() => ({
  addTabIn: vi.fn(), closeTab: vi.fn(), selectTab: vi.fn(), focusPane: vi.fn(),
  splitTabRight: vi.fn(), moveTabToOtherPane: vi.fn(), swapPanes: vi.fn(),
}));
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ws }));
vi.mock("@/lib/queries", () => ({ useIssues: () => ({ data: [] }) }));
vi.mock("@/features/home/DualClock", () => ({ DualClock: () => <div data-testid="clock" /> }));

import { PaneTabStrip } from "./PaneTabStrip";

const pane = { id: "pane-1", tabs: [{ id: "tab-3", view: "list" as const }], activeTabId: "tab-3" };

afterEach(() => {
  cleanup();
  Object.values(ws).forEach((fn) => fn.mockReset());
});

describe("PaneTabStrip", () => {
  it("the pane-local + adds a tab to THIS pane, not the focused one", () => {
    render(<PaneTabStrip pane={pane} focused={false} showClock={false} canClose={false} isSplit={true} />);
    fireEvent.click(screen.getByLabelText("New tab"));
    expect(ws.addTabIn).toHaveBeenCalledWith("pane-1");
  });

  it("shows the clock only when showClock is true", () => {
    const { rerender } = render(<PaneTabStrip pane={pane} focused={false} showClock={false} canClose={false} isSplit={true} />);
    expect(screen.queryByTestId("clock")).toBeNull();
    rerender(<PaneTabStrip pane={pane} focused={false} showClock={true} canClose={false} isSplit={true} />);
    expect(screen.getByTestId("clock")).toBeTruthy();
  });

  it("closing a tab calls closeTab with that tab id", () => {
    render(<PaneTabStrip pane={pane} focused={false} showClock={false} canClose={true} isSplit={true} />);
    fireEvent.click(screen.getByLabelText("Close tab"));
    expect(ws.closeTab).toHaveBeenCalledWith("tab-3");
  });

  it("dropping another pane's tab on this strip moves it here; own tab is a no-op", () => {
    const { container } = render(<PaneTabStrip pane={pane} focused={false} showClock={false} canClose={true} isSplit={true} />);
    const strip = container.firstChild as HTMLElement;
    const dt = (id: string) => ({ getData: () => id, types: ["application/x-astryn-tab"] });
    fireEvent.drop(strip, { dataTransfer: dt("tab-other") });
    expect(ws.moveTabToOtherPane).toHaveBeenCalledWith("tab-other");
    ws.moveTabToOtherPane.mockReset();
    fireEvent.drop(strip, { dataTransfer: dt("tab-3") }); // already in this pane
    expect(ws.moveTabToOtherPane).not.toHaveBeenCalled();
  });
});
