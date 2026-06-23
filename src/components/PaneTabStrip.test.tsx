// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";

// jsdom lacks ResizeObserver; @dnd-kit measures droppables with it.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const ws = vi.hoisted(() => ({
  addTabIn: vi.fn(), closeTab: vi.fn(), selectTab: vi.fn(), focusPane: vi.fn(),
}));
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ws }));
vi.mock("@/lib/queries", () => ({ useIssues: () => ({ data: [] }) }));
vi.mock("@/features/home/DualClock", () => ({ DualClock: () => <div data-testid="clock" /> }));

import { PaneTabStrip } from "./PaneTabStrip";

const pane = { id: "pane-1", tabs: [{ id: "tab-3", view: "list" as const }], activeTabId: "tab-3" };

// Sortable/droppable hooks must run inside a DndContext.
function renderStrip(props: Partial<Parameters<typeof PaneTabStrip>[0]> = {}) {
  return render(
    <DndContext>
      <PaneTabStrip pane={pane} focused={false} showClock={false} canClose={false} isSplit={true} {...props} />
    </DndContext>,
  );
}

afterEach(() => {
  cleanup();
  Object.values(ws).forEach((fn) => fn.mockReset());
});

describe("PaneTabStrip", () => {
  it("the pane-local + adds a tab to THIS pane, not the focused one", () => {
    renderStrip();
    fireEvent.click(screen.getByLabelText("New tab"));
    expect(ws.addTabIn).toHaveBeenCalledWith("pane-1");
  });

  it("shows the clock only when showClock is true", () => {
    const { rerender } = renderStrip();
    expect(screen.queryByTestId("clock")).toBeNull();
    rerender(
      <DndContext>
        <PaneTabStrip pane={pane} focused={false} showClock={true} canClose={false} isSplit={true} />
      </DndContext>,
    );
    expect(screen.getByTestId("clock")).toBeTruthy();
    const clockSlot = document.querySelector("[data-clock-slot]");
    expect(clockSlot).not.toBeNull();
    expect((clockSlot as HTMLElement).className).toContain("ml-3");
    expect((clockSlot as HTMLElement).className).toContain("bg-card/60");
  });

  it("clicking a tab selects it", () => {
    renderStrip();
    fireEvent.click(screen.getByText("Issues"));
    expect(ws.selectTab).toHaveBeenCalledWith("tab-3");
  });

  it("closing a tab calls closeTab with that tab id", () => {
    renderStrip({ canClose: true });
    fireEvent.click(screen.getByLabelText("Close tab"));
    expect(ws.closeTab).toHaveBeenCalledWith("tab-3");
  });
});
