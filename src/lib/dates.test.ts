import { describe, it, expect } from "vitest";
import { dhakaToday, isOverdue, toDateStr, rangeFromDates } from "./dates";

describe("dhakaToday", () => {
  it("rolls into the next day in Dhaka (UTC+6)", () => {
    // 2026-06-19 20:00Z == 2026-06-20 02:00 in Dhaka
    expect(dhakaToday(new Date("2026-06-19T20:00:00Z"))).toBe("2026-06-20");
  });
  it("stays same day before the Dhaka rollover", () => {
    expect(dhakaToday(new Date("2026-06-19T10:00:00Z"))).toBe("2026-06-19");
  });
});

describe("isOverdue", () => {
  const today = "2026-06-19";
  it("flags a past due date that is not done", () => {
    expect(isOverdue("2026-06-18", "started", today)).toBe(true);
  });
  it("does not flag completed/canceled", () => {
    expect(isOverdue("2026-06-18", "completed", today)).toBe(false);
    expect(isOverdue("2026-06-18", "canceled", today)).toBe(false);
  });
  it("does not flag today or future or null", () => {
    expect(isOverdue("2026-06-19", "started", today)).toBe(false);
    expect(isOverdue("2026-06-20", "started", today)).toBe(false);
    expect(isOverdue(null, "started", today)).toBe(false);
  });
});

describe("toDateStr / rangeFromDates", () => {
  it("formats a Date to YYYY-MM-DD using local parts", () => {
    expect(toDateStr(new Date(2026, 5, 9))).toBe("2026-06-09"); // month is 0-based
  });
  it("passes through FullCalendar's exclusive end", () => {
    const r = rangeFromDates(new Date(2026, 5, 1), new Date(2026, 6, 1));
    expect(r).toEqual({ start: "2026-06-01", end: "2026-07-01" });
  });
});
