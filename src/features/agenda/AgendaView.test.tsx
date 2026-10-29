// @vitest-environment jsdom
import { createElement, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DragEndEvent } from "@dnd-kit/core";
import type { IssueListItem } from "@/lib/commands";

// jsdom lacks ResizeObserver; @dnd-kit measures droppables with it.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const h = vi.hoisted(() => ({
  mutate: vi.fn(),
  openMenu: vi.fn(),
  issues: [] as IssueListItem[],
  dnd: null as null | { onDragEnd?: (e: DragEndEvent) => void },
}));

/** End a drag of task `active` over droppable `over`, as @dnd-kit reports it. */
const drop = (active: string, over: string) =>
  act(() => h.dnd?.onDragEnd?.({ active: { id: active }, over: { id: over } } as unknown as DragEndEvent));

vi.mock("@/lib/taskQueries", () => ({
  useTasks: () => ({ data: h.issues, isLoading: false }),
  useViewer: () => ({ viewerIds: ["me", "local-me"], isLoading: false }),
  useUpdateTask: () => ({ mutate: h.mutate }),
}));
vi.mock("@/features/issues/IssueContextMenu", () => ({ useIssueMenu: () => ({ openMenu: h.openMenu }) }));
// Keep the real DndContext, but hold on to its props so a test can end a drag.
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const real = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...real,
    DndContext: (props: ComponentProps<typeof real.DndContext>) => {
      h.dnd = props;
      return createElement(real.DndContext, props);
    },
  };
});

import { AgendaView } from "./AgendaView";

function iss(over: Partial<IssueListItem> & { id: string }): IssueListItem {
  return {
    identifier: `ENG-${over.id}`,
    title: `Task ${over.id}`,
    description: null,
    dueDate: null,
    startedAt: null,
    priority: 0,
    url: "u",
    stateId: null,
    stateName: "Todo",
    stateType: "unstarted",
    stateColor: "#888888",
    assigneeId: "me",
    assigneeName: "Me",
    teamId: null,
    teamKey: null,
    projectId: null,
    projectName: null,
    parentId: null,
    estimate: null,
    cycleName: null,
    cycleNumber: null,
    milestoneName: null,
    linkCount: 0,
    prCount: 0,
    attachmentsTruncated: false,
    createdAt: "c",
    updatedAt: "u",
    labels: [],
    ...over,
  };
}

const card = (identifier: string) => screen.getByRole("button", { name: new RegExp(`^${identifier}:`) });

beforeEach(() => {
  // Thursday Oct 29 2026, midday in Dhaka: the week is Sun Oct 25 – Sat Oct 31.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T06:00:00Z"));
  localStorage.clear();
  h.issues = [
    iss({ id: "lt_1", identifier: "LT-1", dueDate: "2026-10-01", stateType: "started", assigneeId: "local-me" }),
    iss({ id: "12", dueDate: "2026-10-26", priority: 2 }),
    iss({ id: "40", dueDate: "2026-10-29" }),
    iss({ id: "41", dueDate: "2026-10-30", parentId: "40" }),
  ];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  h.mutate.mockReset();
});

const renderView = () =>
  render(
    <MemoryRouter>
      <AgendaView />
    </MemoryRouter>,
  );

describe("AgendaView week board", () => {
  it("lays the week out as Overdue plus Sunday–Saturday columns with today marked", () => {
    renderView();
    const regions = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(regions).toEqual(
      expect.arrayContaining([
        "overdue, 1 task",
        "sun 25, 0 tasks",
        "mon 26, 1 task",
        "thu 29, today, 1 task",
        "fri 30, 1 task",
        "sat 31, 0 tasks",
      ]),
    );
    expect(document.querySelector('[data-today="true"]')?.getAttribute("data-day")).toBe("2026-10-29");
    expect(card("LT-1").getAttribute("aria-label")).toContain("overdue since Oct 1");
    // Tracker-neutral: the local task and the Linear issues share the board.
    expect(card("ENG-12")).toBeTruthy();
  });

  it("keeps the readout strip", () => {
    renderView();
    const counts = screen.getByRole("list", { name: "This week's counts" });
    expect(counts.textContent).toContain("4on your plate");
    expect(counts.textContent).toContain("1overdue");
  });

  it("folds the heatmap into a collapsed activity strip and remembers when it is opened", () => {
    renderView();
    const toggle = screen.getByRole("button", { name: /activity/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: "activity" })).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole("group", { name: "activity" })).toBeTruthy();
    expect(localStorage.getItem("astryn.this-week.activity")).toBe("1");
    cleanup();
    renderView();
    expect(screen.getByRole("button", { name: /activity/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("reschedules a card dropped on another day through the shared task mutation", () => {
    renderView();
    drop("12", "day:2026-10-28");
    expect(h.mutate).toHaveBeenCalledWith({ id: "12", patch: { dueDate: "2026-10-28" } });
  });

  it("refuses drops on Overdue and on the card's own day", () => {
    renderView();
    drop("12", "overdue");
    drop("12", "day:2026-10-26");
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("moves the focused card a day with shift + arrow, never onto Overdue", () => {
    renderView();
    fireEvent.keyDown(card("ENG-40"), { key: "ArrowRight", shiftKey: true });
    expect(h.mutate).toHaveBeenCalledWith({ id: "40", patch: { dueDate: "2026-10-30" } });
    fireEvent.keyDown(card("LT-1"), { key: "ArrowLeft", shiftKey: true });
    expect(h.mutate).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(card("LT-1"), { key: "ArrowRight", shiftKey: true });
    expect(h.mutate).toHaveBeenLastCalledWith({ id: "lt_1", patch: { dueDate: "2026-10-29" } });
  });

  it("moves focus between cards with the arrows instead of changing week", () => {
    renderView();
    const lt = card("LT-1");
    lt.focus();
    fireEvent.keyDown(lt, { key: "ArrowRight" });
    expect(document.activeElement).toBe(card("ENG-12"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Week 44");
    // Off the board, ← / → still change the week.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Week 45");
  });

  it("shows the parent of a sub-issue on its card", () => {
    renderView();
    expect(card("ENG-41").textContent).toContain("ENG-40");
  });
});
