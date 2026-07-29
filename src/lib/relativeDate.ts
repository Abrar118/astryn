const DAY_MS = 86_400_000;

/**
 * Human label for a due date relative to `today`.
 *
 * Both arguments are `YYYY-MM-DD` already resolved in `Asia/Dhaka` — this
 * function does no zone math of its own, so callers must not pass a raw
 * machine-locale date.
 *
 * Returns `null` once the gap is wide enough that an absolute date reads
 * better than a relative one.
 */
export function relativeDueLabel(dueDate: string, today: string): string | null {
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(due) || Number.isNaN(now)) return null;

  const days = Math.round((due - now) / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days < 0 && days >= -6) return `${-days} days ago`;
  if (days > 0 && days <= 6) return `In ${days} days`;
  if (days < 0 && days >= -13) return "Last week";
  if (days > 0 && days <= 13) return "Next week";
  return null;
}

/** True when a due date has passed and the issue is not in a closed state. */
export function isPastDue(
  dueDate: string,
  today: string,
  stateType: string,
): boolean {
  if (stateType === "completed" || stateType === "canceled") return false;
  return dueDate < today;
}
