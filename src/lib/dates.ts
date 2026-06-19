/** Today's calendar date in Asia/Dhaka as YYYY-MM-DD (en-CA yields that format). */
export function dhakaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
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
