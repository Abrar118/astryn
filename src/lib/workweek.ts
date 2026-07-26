import { useSyncExternalStore } from "react";

/** Persisted set of visible weekdays (FullCalendar day numbers, 0 = Sunday).
 *  Days NOT in the set are hidden on the calendar so workdays get more space. */
export const WORKDAYS_KEY = "astryn.workdays";

/** Sun→Sat, indexed by day number (matches FullCalendar's `hiddenDays`). */
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const ALL_DAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

/** Pure: validate persisted workdays JSON. Anything but a non-empty array of
 *  unique day numbers falls back to "all days visible" (the pre-feature look —
 *  and FullCalendar throws outright if every day is hidden). */
export function parseWorkdays(raw: string | null): number[] {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? "null");
  } catch {
    return [...ALL_DAYS];
  }
  if (!Array.isArray(value)) return [...ALL_DAYS];
  const days = [...new Set(value.filter((d): d is number => ALL_DAYS.includes(d as number)))];
  if (days.length === 0) return [...ALL_DAYS];
  return days.sort((a, b) => a - b);
}

/** The complement, in the shape FullCalendar's `hiddenDays` option wants. */
export function hiddenDaysFor(workdays: number[]): number[] {
  return ALL_DAYS.filter((d) => !workdays.includes(d));
}

// Snapshot cache + listeners so `useSyncExternalStore` gets a stable reference
// and every subscribed view (Settings, an open Calendar pane) updates on save.
let cached: number[] | null = null;
const listeners = new Set<() => void>();

export function loadWorkdays(): number[] {
  if (!cached) {
    try {
      cached = parseWorkdays(localStorage.getItem(WORKDAYS_KEY));
    } catch {
      cached = [...ALL_DAYS];
    }
  }
  return cached;
}

export function saveWorkdays(days: number[]): void {
  cached = [...new Set(days)].sort((a, b) => a - b);
  try {
    localStorage.setItem(WORKDAYS_KEY, JSON.stringify(cached));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive workdays: re-renders the subscriber whenever `saveWorkdays` runs. */
export function useWorkdays(): number[] {
  return useSyncExternalStore(subscribe, loadWorkdays);
}
