import type { CalendarIssue } from "@/lib/commands";
import { isOverdue } from "@/lib/dates";

// Linear priority order: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
const PRIORITY_COLORS = ["#6b7280", "#ef4444", "#f97316", "#eab308", "#3b82f6"];

export function eventStyle(i: CalendarIssue, colorBy: "state" | "priority", today: string) {
  const color =
    colorBy === "priority" ? PRIORITY_COLORS[i.priority] ?? "#6b7280" : i.stateColor || "#6b7280";
  return {
    backgroundColor: color,
    borderColor: color,
    classNames: isOverdue(i.dueDate, i.stateType, today) ? ["astryn-overdue"] : [],
  };
}
