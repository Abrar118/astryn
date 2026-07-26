import type { ReportKind, ReportWindowArgs } from "./commands";
import { addDays, dhakaToday, weekWindow } from "./dates";

/** Dhaka is UTC+6 year-round (no DST): midnight of a Dhaka calendar date as a UTC instant. */
export function dhakaMidnightUtc(date: string): string {
  return new Date(`${date}T00:00:00+06:00`).toISOString();
}

const dow = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** "Saturday, July 26" for a YYYY-MM-DD date. */
export function longDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** "July 20" for a YYYY-MM-DD date. */
function monthDay(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** The most recent workday strictly before `today`. With every day off-toggled
 *  invalid (workweek guarantees ≥1 workday), falls back to plain yesterday. */
export function lastWorkday(today: string, workdays: number[]): string {
  let d = today;
  for (let i = 0; i < 7; i++) {
    d = addDays(d, -1);
    if (workdays.includes(dow(d))) return d;
  }
  return addDays(today, -1);
}

/** Daily scrum window: everything since the start of the last workday (Dhaka).
 *  On the first workday after a break this spans the whole gap. */
export function dailyWindow(workdays: number[], now: Date = new Date()): ReportWindowArgs {
  const today = dhakaToday(now);
  const start = lastWorkday(today, workdays);
  const sinceLabel = start === addDays(today, -1) ? "yesterday" : WEEKDAY_NAMES[dow(start)];
  return {
    kind: "daily" satisfies ReportKind,
    since: dhakaMidnightUtc(start),
    sinceLabel,
    today,
    titleDate: longDate(today),
  };
}

/** Weekly review window: the current Sunday-started Dhaka week through now. */
export function weeklyWindow(now: Date = new Date()): ReportWindowArgs {
  const today = dhakaToday(now);
  const { weekStart } = weekWindow(now);
  return {
    kind: "weekly" satisfies ReportKind,
    since: dhakaMidnightUtc(weekStart),
    sinceLabel: monthDay(weekStart),
    today,
    titleDate: longDate(today),
  };
}
