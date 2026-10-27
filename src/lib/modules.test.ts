import { describe, expect, it } from "vitest";
import type { ModuleId } from "@/lib/commands";
import { viewActive, visibleViews } from "./modules";

describe("view registry", () => {
  it("hides views of inactive modules but keeps core", () => {
    const active = (id: ModuleId) => id === "github";
    expect(visibleViews(active)).toEqual(["dashboard", "prs", "settings"]);
  });
  it("issue tabs follow the tracker", () => {
    expect(viewActive("issue", () => false)).toBe(false);
    expect(viewActive("issue", (id) => id === "linear")).toBe(true);
  });
});
