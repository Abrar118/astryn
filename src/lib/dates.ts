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

/** The current Sunday-started week, anchored to today's Asia/Dhaka calendar date. */
export function weekWindow(now: Date = new Date()): WeekWindow {
  const today = dhakaToday(now);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=Sun .. 6=Sat
  const weekStart = addDays(today, -dow);
  return {
    weekStart,
    weekEnd: addDays(weekStart, 7),
    weekdays: [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i)),
    weekend: [5, 6].map((i) => addDays(weekStart, i)),
  };
}
