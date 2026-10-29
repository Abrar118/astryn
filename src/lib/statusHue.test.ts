import { describe, expect, it } from "vitest";
import { statusHue } from "./statusHue";

describe("statusHue", () => {
  it("maps the old local-task palette to its 3:1 replacement", () => {
    expect(statusHue("#D99A2B")).toBe("#ac6721");
    expect(statusHue("#8b8d98")).toBe("#858793");
  });

  it("passes every other color through unchanged", () => {
    expect(statusHue("#f2c94c")).toBe("#f2c94c");
    expect(statusHue("var(--muted-foreground)")).toBe("var(--muted-foreground)");
    expect(statusHue(null)).toBeUndefined();
  });
});
