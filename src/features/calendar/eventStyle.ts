import type { CalendarIssue } from "@/lib/commands";
import { isOverdue } from "@/lib/dates";

// Linear priority order: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
const PRIORITY_COLORS = ["#6b7280", "#ef4444", "#f97316", "#eab308", "#3b82f6"];

/** Resolve an issue's accent color (by state or priority) + overdue flag. */
export function eventAccent(
  i: CalendarIssue,
  colorBy: "state" | "priority",
  today: string,
): { color: string; overdue: boolean } {
  const color =
    colorBy === "priority"
      ? PRIORITY_COLORS[i.priority] ?? "#6b7280"
      : i.stateColor || "#6b7280";
  return { color, overdue: isOverdue(i.dueDate, i.stateType, today) };
}

/** A `#rrggbb` color as an `rgba()` string at the given alpha (for soft chip fills). */
export function tint(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Black or white ink for text sitting on `hex`, chosen by relative luminance
 * (WCAG 2.1). Bright priority fills — amber especially — were rendering white
 * on white and disappearing in the light theme.
 */
export function readableInk(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#f8fafc";
  const n = parseInt(m[1], 16);
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  return luminance > 0.45 ? "#0b0b0f" : "#f8fafc";
}
