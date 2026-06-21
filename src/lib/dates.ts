/** Today's calendar date in Asia/Dhaka as YYYY-MM-DD (en-CA yields that format). */
export function dhakaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** An instant's calendar date in Asia/Dhaka as YYYY-MM-DD. */
export function dhakaDateFromTimestamp(timestamp: string): string {
  return dhakaToday(new Date(timestamp));
}

/** Overdue = past due date on an issue that isn't completed/canceled. */
export function isOverdue(
  dueDate: string | null,
  stateType: string,
  today: string,
): boolean {
  if (!dueDate) return false;
  if (stateType === "completed" || stateType === "canceled") return false;
  return dueDate < today;
}

/** A Date's local calendar day as YYYY-MM-DD. */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** FullCalendar's activeStart/activeEnd are already half-open (end exclusive). */
export function rangeFromDates(start: Date, end: Date): { start: string; end: string } {
  return { start: toDateStr(start), end: toDateStr(end) };
}

export type WeekWindow = {
  /** Sunday of the current Dhaka week, YYYY-MM-DD (inclusive). */
  weekStart: string;
  /** The following Sunday, YYYY-MM-DD (exclusive). */
  weekEnd: string;
  /** [Sun, Mon, Tue, Wed, Thu] as YYYY-MM-DD. */
  weekdays: string[];
  /** [Fri, Sat] as YYYY-MM-DD. */
  weekend: string[];
};

/** Add `n` days to a YYYY-MM-DD string. UTC arithmetic avoids DST/local drift. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The current Sunday-started week, anchored to today's Asia/Dhaka calendar date.
 *  Pass `offsetWeeks` to shift the whole window by that many weeks (negative = past, positive = future). */
export function weekWindow(now: Date = new Date(), offsetWeeks = 0): WeekWindow {
  const today = dhakaToday(now);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=Sun .. 6=Sat
  const thisSunday = addDays(today, -dow);
  const weekStart = addDays(thisSunday, offsetWeeks * 7);
  return {
    weekStart,
    weekEnd: addDays(weekStart, 7),
    weekdays: [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i)),
    weekend: [5, 6].map((i) => addDays(weekStart, i)),
  };
}

/** ISO 8601 week number for a YYYY-MM-DD date string.
 *  Weeks start Monday; week 1 is the week containing the first Thursday of the year.
 *  The returned `year` may differ from the calendar year near year boundaries. */
export function isoWeek(date: string): { week: number; year: number } {
  const d = new Date(`${date}T00:00:00Z`);
  const calYear = d.getUTCFullYear();

  /** Monday that starts ISO week 1 for a given year. */
  function week1Start(y: number): Date {
    const jan4 = new Date(Date.UTC(y, 0, 4));
    // (getUTCDay() + 6) % 7 gives 0=Mon … 6=Sun
    jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
    return jan4;
  }

  // Check if this date already belongs to next ISO year.
  const nextYearW1 = week1Start(calYear + 1);
  if (d >= nextYearW1) {
    return { week: 1, year: calYear + 1 };
  }

  const thisYearW1 = week1Start(calYear);
  if (d < thisYearW1) {
    // Belongs to the last week of the previous ISO year.
    const prevYearW1 = week1Start(calYear - 1);
    const weekNum = Math.floor((d.getTime() - prevYearW1.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
    return { week: weekNum, year: calYear - 1 };
  }

  const weekNum = Math.floor((d.getTime() - thisYearW1.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return { week: weekNum, year: calYear };
}
