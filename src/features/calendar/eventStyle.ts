import type { CalendarIssue } from "@/lib/commands";
import { isOverdue } from "@/lib/dates";

// Linear priority order: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
const PRIORITY_COLORS = [
  "var(--muted-foreground)",
  "var(--destructive)",
  "var(--warning)",
  "var(--info)",
  "var(--muted-foreground)",
];

/** Resolve an issue's accent color (by state or priority) + overdue flag. */
export function eventAccent(
  i: CalendarIssue,
  colorBy: "state" | "priority",
  today: string,
): { color: string; overdue: boolean } {
  const color =
    colorBy === "priority"
      ? PRIORITY_COLORS[i.priority] ?? "var(--muted-foreground)"
      : i.stateColor || "var(--muted-foreground)";
  return { color, overdue: isOverdue(i.dueDate, i.stateType, today) };
}

/** Any CSS color (hex from Linear data or a theme `var(--…)`) at the given alpha (for soft chip fills). */
export function tint(color: string, alpha: number): string {
  return `color-mix(in oklab, ${color.trim()} ${Math.round(alpha * 100)}%, transparent)`;
}
