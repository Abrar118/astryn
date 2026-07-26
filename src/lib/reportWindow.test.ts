import { describe, expect, it } from "vitest";
import { dailyWindow, dhakaMidnightUtc, lastWorkday, longDate, weeklyWindow } from "./reportWindow";

// 2026-07-26 is a Sunday. 10:00 Dhaka = 04:00 UTC.
const SUNDAY = new Date("2026-07-26T04:00:00Z");
const SUN_THU = [0, 1, 2, 3, 4]; // Fri+Sat weekend (Dhaka workweek)

describe("dhakaMidnightUtc", () => {
  it("converts a Dhaka calendar date to the UTC instant 6h earlier", () => {
    expect(dhakaMidnightUtc("2026-07-26")).toBe("2026-07-25T18:00:00.000Z");
  });
});

describe("lastWorkday", () => {
  it("is plain yesterday mid-week", () => {
    expect(lastWorkday("2026-07-22", SUN_THU)).toBe("2026-07-21"); // Wed → Tue
  });
  it("skips the Fri–Sat weekend from Sunday back to Thursday", () => {
    expect(lastWorkday("2026-07-26", SUN_THU)).toBe("2026-07-23");
  });
  it("falls back to yesterday when workdays never match", () => {
    expect(lastWorkday("2026-07-26", [])).toBe("2026-07-25");
  });
});

describe("dailyWindow", () => {
  it("labels a post-weekend gap with the weekday name", () => {
    const w = dailyWindow(SUN_THU, SUNDAY);
    expect(w.kind).toBe("daily");
    expect(w.today).toBe("2026-07-26");
    expect(w.since).toBe(dhakaMidnightUtc("2026-07-23")); // Thursday 00:00 Dhaka
    expect(w.sinceLabel).toBe("Thursday");
    expect(w.titleDate).toBe("Sunday, July 26");
  });
  it("labels a plain 1-day gap as yesterday", () => {
    const monday = new Date("2026-07-27T04:00:00Z");
    expect(dailyWindow(SUN_THU, monday).sinceLabel).toBe("yesterday");
  });
});

describe("weeklyWindow", () => {
  it("starts at the current Dhaka week's Sunday", () => {
    // Wed Jul 22 → week starts Sun Jul 19.
    const wed = new Date("2026-07-22T04:00:00Z");
    const w = weeklyWindow(wed);
    expect(w.kind).toBe("weekly");
    expect(w.since).toBe(dhakaMidnightUtc("2026-07-19"));
    expect(w.sinceLabel).toBe("July 19");
  });
  it("a Sunday is its own week start", () => {
    expect(weeklyWindow(SUNDAY).since).toBe(dhakaMidnightUtc("2026-07-26"));
  });
});

describe("longDate", () => {
  it("formats weekday, month and day", () => {
    expect(longDate("2026-07-26")).toBe("Sunday, July 26");
  });
});
