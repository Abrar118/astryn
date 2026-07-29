import { describe, expect, it } from "vitest";
import { isPastDue, relativeDueLabel } from "./relativeDate";

const TODAY = "2026-07-29";

describe("relativeDueLabel", () => {
  it("names the day for the immediate neighbours", () => {
    expect(relativeDueLabel("2026-07-29", TODAY)).toBe("Today");
    expect(relativeDueLabel("2026-07-30", TODAY)).toBe("Tomorrow");
    expect(relativeDueLabel("2026-07-28", TODAY)).toBe("Yesterday");
  });

  it("counts days inside the first week", () => {
    expect(relativeDueLabel("2026-07-25", TODAY)).toBe("4 days ago");
    expect(relativeDueLabel("2026-08-03", TODAY)).toBe("In 5 days");
  });

  it("falls back to a week label in the second week", () => {
    expect(relativeDueLabel("2026-07-20", TODAY)).toBe("Last week");
    expect(relativeDueLabel("2026-08-09", TODAY)).toBe("Next week");
  });

  it("returns null once an absolute date reads better", () => {
    expect(relativeDueLabel("2026-06-01", TODAY)).toBeNull();
    expect(relativeDueLabel("2026-09-01", TODAY)).toBeNull();
  });

  it("returns null for an unparseable date", () => {
    expect(relativeDueLabel("not-a-date", TODAY)).toBeNull();
  });

  it("crosses a month boundary without drifting", () => {
    expect(relativeDueLabel("2026-08-01", "2026-07-31")).toBe("Tomorrow");
  });
});

describe("isPastDue", () => {
  it("flags an open issue whose due date has passed", () => {
    expect(isPastDue("2026-07-28", TODAY, "started")).toBe(true);
  });

  it("ignores closed issues", () => {
    expect(isPastDue("2026-07-01", TODAY, "completed")).toBe(false);
    expect(isPastDue("2026-07-01", TODAY, "canceled")).toBe(false);
  });

  it("does not flag today or the future", () => {
    expect(isPastDue(TODAY, TODAY, "started")).toBe(false);
    expect(isPastDue("2026-08-05", TODAY, "unstarted")).toBe(false);
  });
});
