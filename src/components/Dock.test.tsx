// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const setActiveView = vi.hoisted(() => vi.fn());
const activeView = vi.hoisted(() => ({ current: "dashboard" }));
const moduleOn = vi.hoisted(() => ({ current: (_id: string) => true }));

vi.mock("@/lib/tabs", () => ({
  useWorkspace: () => ({ active: { view: activeView.current }, setActiveView, addTab: vi.fn() }),
}));
vi.mock("@/lib/modules", async (orig) => ({
  ...(await orig<typeof import("@/lib/modules")>()),
  useModules: () => ({ isActive: (id: string) => moduleOn.current(id), disabledScreens: [], hasCapability: () => true, ready: true }),
}));

import { Dock } from "./Dock";
import { dockEntries } from "@/lib/modules";

afterEach(() => {
  cleanup();
  setActiveView.mockReset();
  activeView.current = "dashboard";
  moduleOn.current = () => true;
});

describe("dockEntries", () => {
  it("folds related screens into one entry at the first member's position", () => {
    const entries = dockEntries(["dashboard", "calendar", "list", "this-week", "graph", "inbox", "prs", "bitbucket-prs", "slack", "teams", "settings"]);
    expect(entries.map((e) => (e.kind === "group" ? `group:${e.group.id}` : e.view))).toEqual([
      "dashboard", "calendar", "group:linear", "group:planning", "group:code", "group:chat", "settings",
    ]);
  });

  it("collapses a group with one shown member to that view's own button", () => {
    const entries = dockEntries(["dashboard", "prs", "list"]);
    expect(entries).toEqual([
      { kind: "view", view: "dashboard" },
      { kind: "view", view: "prs" },
      { kind: "view", view: "list" },
    ]);
  });
});

describe("Dock groups", () => {
  it("opens the group's default screen from its icon", () => {
    render(<Dock isSyncing={false} refresh={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Linear: Issues" }));
    expect(setActiveView).toHaveBeenCalledWith("list");
  });

  it("lists the other screens in a drop-up from the chevron", () => {
    render(<Dock isSyncing={false} refresh={() => {}} />);
    const chevron = screen.getByRole("button", { name: "More Linear screens" });
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(chevron);
    const menu = screen.getByRole("menu", { name: "Linear" });
    expect(chevron.getAttribute("aria-expanded")).toBe("true");
    const items = Array.from(menu.querySelectorAll("[role=menuitem]")).map((el) => el.textContent);
    expect(items).toEqual(["Issuesdefault", "Inbox"]);
    fireEvent.click(screen.getByRole("menuitem", { name: /Inbox/ }));
    expect(setActiveView).toHaveBeenCalledWith("inbox");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes the drop-up with Escape and returns focus to the chevron", () => {
    render(<Dock isSyncing={false} refresh={() => {}} />);
    const chevron = screen.getByRole("button", { name: "More Pull requests screens" });
    fireEvent.click(chevron);
    const menu = screen.getByRole("menu", { name: "Pull requests" });
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(chevron);
  });

  it("keeps the group's icon on the screen you are on", () => {
    activeView.current = "inbox";
    render(<Dock isSyncing={false} refresh={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Linear: Inbox" }));
    expect(setActiveView).toHaveBeenCalledWith("inbox");
  });
});
