// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

const mods = vi.hoisted(() => ({ ids: new Set<string>(["linear"]), screensOff: [] as string[], data: {} }));
vi.mock("./modules", async (orig) => ({
  ...(await orig<typeof import("./modules")>()),
  useModules: () => ({
    data: mods.data, // stable until a test changes the module state
    isActive: (id: string) => mods.ids.has(id),
    disabledScreens: mods.screensOff,
  }),
}));

import { WorkspaceProvider, useWorkspace } from "./tabs";

const wrapper = ({ children }: { children: ReactNode }) => <WorkspaceProvider>{children}</WorkspaceProvider>;

afterEach(() => {
  cleanup();
  localStorage.clear();
  mods.ids = new Set(["linear"]);
  mods.screensOff = [];
  mods.data = {};
});

describe("workspace openers", () => {
  it("cannot open a switched-off screen", () => {
    mods.screensOff = ["inbox"];
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    act(() => result.current.setActiveView("list"));
    act(() => result.current.setActiveView("inbox"));
    expect(result.current.active.view).toBe("list");
    act(() => result.current.addTab("inbox"));
    expect(result.current.active.view).toBe("dashboard");
  });

  it("falls back to the dashboard for a new tab of an inactive module", () => {
    mods.ids = new Set();
    const { result } = renderHook(() => useWorkspace(), { wrapper });
    act(() => result.current.addTab());
    expect(result.current.tabs.map((t) => t.view)).not.toContain("calendar");
    act(() => result.current.openIssueTab("iss-1"));
    expect(result.current.tabs.some((t) => t.view === "issue")).toBe(false);
  });

  it("closes open tabs of a screen that is switched off", () => {
    const { result, rerender } = renderHook(() => useWorkspace(), { wrapper });
    act(() => result.current.addTab("inbox"));
    expect(result.current.tabs.some((t) => t.view === "inbox")).toBe(true);
    mods.screensOff = ["inbox"];
    mods.data = {};
    rerender();
    expect(result.current.tabs.some((t) => t.view === "inbox")).toBe(false);
  });
});
