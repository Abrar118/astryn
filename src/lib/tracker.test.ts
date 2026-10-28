import { describe, expect, it } from "vitest";
import { ME, TRACKER_ADAPTERS, resolveAllFilters, resolveFilters, trackerOf } from "./tracker";
import { TRACKER_MODULES, trackerModulesActive } from "./modules";

describe("trackerOf", () => {
  it("treats bare ids as Linear", () => {
    expect(trackerOf("0b6c7c4e-1b2a-4a7e-9a55-6f0b7c1d2e3f")).toBe("linear");
  });
});

describe("resolveFilters", () => {
  it("keeps plain filters as they are", () => {
    expect(resolveFilters("linear", { teamId: "t1", assigneeId: "u1" }, {})).toEqual({ teamId: "t1", assigneeId: "u1" });
  });

  it("swaps ME for the tracker's viewer id", () => {
    expect(resolveFilters("linear", { assigneeId: ME, projectId: "p" }, { linear: "v1" })).toEqual({
      assigneeId: "v1",
      projectId: "p",
    });
  });

  it("skips a tracker whose viewer is unknown when asked for ME", () => {
    expect(resolveFilters("linear", { assigneeId: ME }, {})).toBeNull();
  });
});

describe("resolveAllFilters", () => {
  it("resolves ME per tracker when a viewer is known", () => {
    expect(resolveAllFilters(["linear"], { assigneeId: ME }, { linear: "v1" })).toEqual([["linear", { assigneeId: "v1" }]]);
  });

  it("drops the assignee filter when no tracker knows its viewer, instead of showing nothing", () => {
    expect(resolveAllFilters(["linear"], { assigneeId: ME, teamId: "t" }, {})).toEqual([["linear", { teamId: "t" }]]);
  });
});

describe("tracker registry", () => {
  it("has an adapter for exactly the modules that provide the tracker capability", () => {
    expect([...TRACKER_MODULES].sort()).toEqual(Object.keys(TRACKER_ADAPTERS).sort());
  });

  it("is active while any tracker module is active", () => {
    expect(trackerModulesActive((id) => id === "linear")).toBe(true);
    expect(trackerModulesActive(() => false)).toBe(false);
  });
});
