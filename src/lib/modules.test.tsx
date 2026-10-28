// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ModuleId } from "@/lib/commands";

const listModules = vi.hoisted(() => vi.fn());
vi.mock("@/lib/commands", () => ({ listModules }));

import { MODULE_MANIFEST, SWITCHABLE_SCREENS, VIEW_META, tabActive, useModules, viewActive, visibleViews } from "./modules";

const wrap = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("view registry", () => {
  it("hides views of inactive modules but keeps core", () => {
    const active = (id: ModuleId) => id === "github";
    expect(visibleViews(active)).toEqual(["dashboard", "prs", "settings"]);
  });
  it("shows tracker views while any tracker module is on", () => {
    expect(visibleViews((id) => id === "linear")).toEqual(expect.arrayContaining(["calendar", "this-week", "graph", "list", "inbox"]));
    expect(viewActive("calendar", () => false)).toBe(false);
  });
  it("shows the Teams view only while Teams is active", () => {
    expect(visibleViews((id) => id === "teams")).toEqual(["dashboard", "teams", "settings"]);
    expect(viewActive("teams", (id) => id === "slack")).toBe(false);
  });
  it("issue tabs follow their own tracker", () => {
    expect(viewActive("issue", () => false)).toBe(false);
    expect(viewActive("issue", (id) => id === "linear")).toBe(true);
    const tab = { id: "t1", view: "issue" as const, issueId: "0b6c7c4e-uuid" };
    expect(tabActive(tab, (id) => id === "linear")).toBe(true);
    expect(tabActive(tab, () => false)).toBe(false);
    expect(tabActive({ id: "t2", view: "calendar" }, (id) => id === "linear")).toBe(true);
  });
  it("hides switched-off screens but never Calendar, Dashboard or Settings", () => {
    const linear = (id: ModuleId) => id === "linear";
    expect(visibleViews(linear, ["inbox", "graph"])).toEqual(["dashboard", "calendar", "list", "this-week", "settings"]);
    expect(visibleViews(linear, SWITCHABLE_SCREENS)).toEqual(["dashboard", "calendar", "settings"]);
    expect(viewActive("inbox", linear, ["inbox"])).toBe(false);
    expect(viewActive("inbox", linear, [])).toBe(true);
    expect(viewActive("issue", linear, SWITCHABLE_SCREENS)).toBe(true);
  });
  it("only module-owned screens are switchable", () => {
    for (const s of SWITCHABLE_SCREENS) expect(VIEW_META[s].module).not.toBe("core");
    expect(SWITCHABLE_SCREENS).not.toContain("calendar");
  });
});

describe("MODULE_MANIFEST", () => {
  it("pins every entry", () => {
    expect(MODULE_MANIFEST).toEqual({
      linear: { kind: "provider", provides: ["tracker", "notifications"], requires: [], optional: [] },
      github: { kind: "provider", provides: ["code-host", "docs-source"], requires: [], optional: [] },
      bitbucket: { kind: "provider", provides: ["code-host"], requires: [], optional: [] },
      slack: { kind: "provider", provides: ["chat"], requires: [], optional: [] },
      llm: { kind: "provider", provides: ["llm"], requires: [], optional: [] },
      // Local folders need no provider, so a docs source is optional.
      docs: { kind: "feature", provides: [], requires: [], optional: ["docs-source"] },
      reports: { kind: "feature", provides: [], requires: ["tracker"], optional: ["code-host", "llm"] },
      "link-previews": { kind: "feature", provides: [], requires: [], optional: [] },
      teams: { kind: "provider", provides: ["chat"], requires: [], optional: [] },
      clickup: { kind: "provider", provides: ["docs-source"], requires: [], optional: [] },
    });
  });
});

describe("useModules", () => {
  it("reports nothing active while loading, then derives capabilities from active providers", async () => {
    listModules.mockReturnValue(new Promise(() => {}));
    const loading = renderHook(() => useModules(), { wrapper: wrap() });
    expect(loading.result.current.ready).toBe(false);
    expect(loading.result.current.isActive("linear")).toBe(false);

    const mod = (id: string, enabled: boolean) => ({ id, kind: "provider", enabled, available: true, missing: [] });
    listModules.mockResolvedValue({ onboarded: true, modules: [mod("github", true), mod("linear", false)], disabledScreens: [] });
    const loaded = renderHook(() => useModules(), { wrapper: wrap() });
    await waitFor(() => expect(loaded.result.current.ready).toBe(true));
    expect(loaded.result.current.hasCapability("docs-source")).toBe(true);
    expect(loaded.result.current.hasCapability("tracker")).toBe(false);
  });

  it("applies the screen layer and exposes load failures for a retry", async () => {
    const mod = (id: string) => ({ id, kind: "provider", enabled: true, available: true, missing: [] });
    listModules.mockResolvedValue({ onboarded: true, modules: [mod("linear")], disabledScreens: ["inbox"] });
    const { result } = renderHook(() => useModules(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.disabledScreens).toEqual(["inbox"]);
    expect(result.current.isViewActive("inbox")).toBe(false);
    expect(result.current.isViewActive("list")).toBe(true);

    listModules.mockRejectedValue("Internal error.");
    const failed = renderHook(() => useModules(), { wrapper: wrap() });
    await waitFor(() => expect(failed.result.current.isError).toBe(true));
    listModules.mockResolvedValue({ onboarded: true, modules: [mod("linear")], disabledScreens: [] });
    await failed.result.current.refetch();
    await waitFor(() => expect(failed.result.current.ready).toBe(true));
  });
});
