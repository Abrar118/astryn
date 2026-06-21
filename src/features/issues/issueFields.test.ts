import { describe, it, expect } from "vitest";
import { PRIORITIES, DUE_PRESETS } from "./issueFields";

describe("issueFields", () => {
  it("exposes the five priorities with No priority last", () => {
    expect(PRIORITIES.map((p) => p.label)).toEqual([
      "Urgent",
      "High",
      "Medium",
      "Low",
      "No priority",
    ]);
  });
  it("resolves due presets relative to a given today", () => {
    const today = "2026-06-21";
    const byLabel = new Map(DUE_PRESETS.map((p) => [p.label, p.resolve(today)]));
    expect(byLabel.get("Today")).toBe("2026-06-21");
    expect(byLabel.get("Tomorrow")).toBe("2026-06-22");
    expect(byLabel.get("Next week")).toBe("2026-06-28");
    expect(byLabel.get("No due date")).toBeNull();
  });
});
