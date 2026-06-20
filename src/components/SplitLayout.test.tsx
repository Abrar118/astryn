// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// jsdom has no ResizeObserver; SplitLayout constructs one when split.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const ws = vi.hoisted(() => ({
  panes: [
    { id: "pane-0", tabs: [{ id: "tab-0", view: "calendar" }], activeTabId: "tab-0" },
    { id: "pane-1", tabs: [{ id: "tab-1", view: "list" }], activeTabId: "tab-1" },
  ],
  focusedPaneId: "pane-0",
  ratio: 0.5,
  splitTabRight: vi.fn(),
  swapPanes: vi.fn(),
  setRatio: vi.fn(),
}));
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ws }));
vi.mock("./PaneTabStrip", () => ({
  TAB_DND_TYPE: "application/x-astryn-tab",
  PaneTabStrip: ({ pane }: { pane: { id: string } }) => <div data-testid={`strip-${pane.id}`} />,
}));
vi.mock("@/features/calendar/CalendarPage", () => ({ CalendarPage: () => <div>cal</div> }));
vi.mock("@/features/issues/IssuesView", () => ({ IssuesView: () => <div>list</div> }));
vi.mock("@/features/inbox/InboxView", () => ({ InboxView: () => <div>inbox</div> }));
vi.mock("@/features/settings/Settings", () => ({ Settings: () => <div>settings</div> }));
vi.mock("@/features/drawer/IssuePage", () => ({ IssuePage: () => <div>issue</div> }));

import { SplitLayout } from "./SplitLayout";

afterEach(() => { cleanup(); ws.splitTabRight.mockReset(); ws.swapPanes.mockReset(); ws.setRatio.mockReset(); });

describe("SplitLayout", () => {
  it("renders a strip per pane and the swap button when split", () => {
    render(<SplitLayout />);
    expect(screen.getByTestId("strip-pane-0")).toBeTruthy();
    expect(screen.getByTestId("strip-pane-1")).toBeTruthy();
    expect(screen.getByLabelText("Swap panes")).toBeTruthy();
  });

  it("dropping a tab on the right-half overlay calls splitTabRight with the dragged id", () => {
    render(<SplitLayout />);
    const dataTransfer = { getData: (t: string) => (t === "application/x-astryn-tab" ? "tab-0" : ""), types: ["application/x-astryn-tab"] };
    // A tab drag must be in progress for the overlay to render; SplitLayout listens on window.
    fireEvent.dragStart(screen.getByTestId("strip-pane-0"), { dataTransfer });
    const overlay = screen.getByTestId("right-drop-zone");
    fireEvent.drop(overlay, { dataTransfer });
    expect(ws.splitTabRight).toHaveBeenCalledWith("tab-0");
  });

  it("ArrowRight on the divider nudges the ratio up", () => {
    render(<SplitLayout />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
    expect(ws.setRatio).toHaveBeenCalled();
  });

  it("pointer-drag updates the ratio and removes listeners on pointer up", () => {
    render(<SplitLayout />);
    fireEvent.pointerDown(screen.getByRole("separator"));
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 100 }));
    expect(ws.setRatio).toHaveBeenCalled();
    ws.setRatio.mockReset();
    window.dispatchEvent(new MouseEvent("pointerup"));
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 200 }));
    expect(ws.setRatio).not.toHaveBeenCalled(); // listener torn down
  });

  it("removes drag listeners when unmounted mid-drag", () => {
    const { unmount } = render(<SplitLayout />);
    fireEvent.pointerDown(screen.getByRole("separator"));
    unmount();
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 100 }));
    expect(ws.setRatio).not.toHaveBeenCalled();
  });
});
