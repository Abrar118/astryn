// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const ws = vi.hoisted(() => ({
  addTabIn: vi.fn(), closeTab: vi.fn(), focusPane: vi.fn(),
}));
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ws }));
vi.mock("@/lib/queries", () => ({ useIssues: () => ({ data: [] }) }));
vi.mock("@/features/home/DualClock", () => ({ DualClock: () => <div data-testid="clock" /> }));

import { PaneTabStrip } from "./PaneTabStrip";

const pane = { id: "pane-1", tabs: [{ id: "tab-3", view: "list" as const }], activeTabId: "tab-3" };

// Tab dragging is owned by SplitLayout; the strip just forwards these.
const dndProps = { draggingTabId: null, onTabPointerDown: vi.fn(), onTabPointerMove: vi.fn(), onTabPointerUp: vi.fn() };

afterEach(() => {
  cleanup();
  Object.values(ws).forEach((fn) => fn.mockReset());
});

describe("PaneTabStrip", () => {
  it("the pane-local + adds a tab to THIS pane, not the focused one", () => {
    render(<PaneTabStrip pane={pane} focused={false} showClock={false} canClose={false} isSplit={true} {...dndProps} />);
    fireEvent.click(screen.getByLabelText("New tab"));
    expect(ws.addTabIn).toHaveBeenCalledWith("pane-1");
  });

  it("shows the clock only when showClock is true", () => {
    const { rerender } = render(<PaneTabStrip pane={pane} focused={false} showClock={false} canClose={false} isSplit={true} {...dndProps} />);
    expect(screen.queryByTestId("clock")).toBeNull();
    rerender(<PaneTabStrip pane={pane} focused={false} showClock={true} canClose={false} isSplit={true} {...dndProps} />);
    expect(screen.getByTestId("clock")).toBeTruthy();
  });

  it("closing a tab calls closeTab with that tab id", () => {
    render(<PaneTabStrip pane={pane} focused={false} showClock={false} canClose={true} isSplit={true} {...dndProps} />);
    fireEvent.click(screen.getByLabelText("Close tab"));
    expect(ws.closeTab).toHaveBeenCalledWith("tab-3");
  });

  it("forwards a tab pointer-down to the drag handler with its id and pane id", () => {
    const onTabPointerDown = vi.fn();
    render(
      <PaneTabStrip
        pane={pane}
        focused={false}
        showClock={false}
        canClose={false}
        isSplit={true}
        draggingTabId={null}
        onTabPointerDown={onTabPointerDown}
        onTabPointerMove={vi.fn()}
        onTabPointerUp={vi.fn()}
      />,
    );
    fireEvent.pointerDown(screen.getByText("Issues"));
    expect(onTabPointerDown).toHaveBeenCalled();
    const [, tabId, paneId] = onTabPointerDown.mock.calls[0];
    expect(tabId).toBe("tab-3");
    expect(paneId).toBe("pane-1");
  });
});
