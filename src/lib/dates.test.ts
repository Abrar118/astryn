import { describe, it, expect } from "vitest";
import { dhakaDateFromTimestamp, dhakaToday, isOverdue, toDateStr, rangeFromDates, addDays, weekWindow, isoWeek } from "./dates";

describe("dhakaToday", () => {
  it("rolls into the next day in Dhaka (UTC+6)", () => {
    // 2026-06-19 20:00Z == 2026-06-20 02:00 in Dhaka
    expect(dhakaToday(new Date("2026-06-19T20:00:00Z"))).toBe("2026-06-20");
  });
  it("stays same day before the Dhaka rollover", () => {
    expect(dhakaToday(new Date("2026-06-19T10:00:00Z"))).toBe("2026-06-19");
  });
});

describe("dhakaDateFromTimestamp", () => {
  it("uses the Dhaka calendar day across a UTC boundary", () => {
    expect(dhakaDateFromTimestamp("2026-06-18T20:30:00Z")).toBe("2026-06-19");
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

describe("addDays", () => {
  it("adds and subtracts days across month boundaries (UTC-safe)", () => {
    expect(addDays("2026-06-21", 1)).toBe("2026-06-22");
    expect(addDays("2026-07-01", -1)).toBe("2026-06-30");
    expect(addDays("2026-06-21", 7)).toBe("2026-06-28");
  });
});

describe("weekWindow (Asia/Dhaka, Sunday-started)", () => {
  it("computes the Sunday→next-Sunday window for a mid-week day", () => {
    // 2026-06-24 is a Wednesday; that week's Sunday is 2026-06-21.
    const w = weekWindow(new Date("2026-06-24T06:00:00Z"));
    expect(w.weekStart).toBe("2026-06-21");
    expect(w.weekEnd).toBe("2026-06-28");
    expect(w.weekdays).toEqual([
      "2026-06-21", "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25",
    ]);
    expect(w.weekend).toEqual(["2026-06-26", "2026-06-27"]);
  });

  it("treats Sunday as the first day of its own week", () => {
    const w = weekWindow(new Date("2026-06-21T06:00:00Z"));
    expect(w.weekStart).toBe("2026-06-21");
  });

  it("uses Dhaka calendar date past the UTC midnight rollover", () => {
    // 2026-06-20 20:00Z == 2026-06-21 02:00 Dhaka (a Sunday) -> weekStart that Sunday.
    const w = weekWindow(new Date("2026-06-20T20:00:00Z"));
    expect(w.weekStart).toBe("2026-06-21");
  });
});

describe("weekWindow with offsetWeeks", () => {
  // Anchor: 2026-06-24 (Wed) → week starts 2026-06-21 (Sun)
  const NOW = new Date("2026-06-24T06:00:00Z");

  it("offset 0 equals the no-arg result (same now)", () => {
    const base = weekWindow(NOW);
    const offset0 = weekWindow(NOW, 0);
    expect(offset0).toEqual(base);
  });

  it("offset -1 shifts weekStart back exactly 7 days", () => {
    const base = weekWindow(NOW);
    const prev = weekWindow(NOW, -1);
    expect(prev.weekStart).toBe("2026-06-14");
    expect(addDays(prev.weekStart, 7)).toBe(base.weekStart);
  });

  it("offset +1 shifts weekStart forward exactly 7 days", () => {
    const base = weekWindow(NOW);
    const next = weekWindow(NOW, 1);
    expect(next.weekStart).toBe("2026-06-28");
    expect(addDays(base.weekStart, 7)).toBe(next.weekStart);
  });

  it("weekdays and weekend arrays shift with the week", () => {
    const prev = weekWindow(NOW, -1);
    // weekStart = 2026-06-14 (Sun); weekdays = Sun–Thu, weekend = Fri–Sat
    expect(prev.weekdays).toEqual([
      "2026-06-14", "2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18",
    ]);
    expect(prev.weekend).toEqual(["2026-06-19", "2026-06-20"]);
  });
});

describe("isoWeek", () => {
  it("2026-01-01 is a Thursday → ISO week 1 of 2026", () => {
    expect(isoWeek("2026-01-01")).toEqual({ week: 1, year: 2026 });
  });

  it("2027-01-01 is a Friday → ISO week 53 of 2026 (previous ISO year)", () => {
    // 2027-01-01 is a Friday; the Thursday of that week falls in 2026 → ISO year 2026.
    expect(isoWeek("2027-01-01")).toEqual({ week: 53, year: 2026 });
  });

  it("2026-06-24 is a Wednesday → ISO week 26 of 2026", () => {
    expect(isoWeek("2026-06-24")).toEqual({ week: 26, year: 2026 });
  });
});
