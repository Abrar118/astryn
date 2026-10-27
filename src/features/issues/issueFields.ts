import { addDays } from "@/lib/dates";

/** Linear priority values (0 = none) with display label + color. */
export const PRIORITIES = [
  { value: 1, label: "Urgent", color: "var(--destructive)" },
  { value: 2, label: "High", color: "var(--warning)" },
  { value: 3, label: "Medium", color: "var(--info)" },
  { value: 4, label: "Low", color: "var(--muted-foreground)" },
  { value: 0, label: "No priority", color: "var(--muted-foreground)" },
];

/** Workflow-state ordering for sorting state lists. */
export const STATE_RANK: Record<string, number> = {
  backlog: 0,
  unstarted: 1,
  started: 2,
  completed: 3,
  canceled: 4,
};

export type DuePreset = { label: string; resolve: (today: string) => string | null };

/** Quick due-date choices, resolved against a Dhaka `today` (YYYY-MM-DD). */
export const DUE_PRESETS: DuePreset[] = [
  { label: "Today", resolve: (t) => t },
  { label: "Tomorrow", resolve: (t) => addDays(t, 1) },
  { label: "Next week", resolve: (t) => addDays(t, 7) },
  { label: "No due date", resolve: () => null },
];
