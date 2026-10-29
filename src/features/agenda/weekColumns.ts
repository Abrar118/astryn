import type { Task } from "@/lib/tracker";
import { addDays, type WeekWindow } from "@/lib/dates";
import { dueIssues, type AgendaGroup } from "./agenda";

/** The key of the board's Overdue column; every other column is keyed by its date. */
export const OVERDUE = "overdue";

export type BoardColumn = {
  /** "overdue", or the day's YYYY-MM-DD. */
  key: string;
  /** The day's YYYY-MM-DD; null for Overdue. */
  date: string | null;
  /** Lowercase legend: "overdue" or "sun 25". */
  label: string;
  /** One card per due task, sub-issues included (they move on their own). */
  cards: Task[];
};

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** "sun 25" for a YYYY-MM-DD date. */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()}`;
}

/** Urgent (1) first, no priority (0) last, then by identifier. */
const prioRank = (p: number) => (p === 0 ? 5 : p);
const byPriority = (a: Task, b: Task) =>
  prioRank(a.priority) - prioRank(b.priority) || a.identifier.localeCompare(b.identifier);
/** Overdue reads oldest first. */
const byDueDate = (a: Task, b: Task) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || byPriority(a, b);

/**
 * Lay the week's agenda out as board columns: Overdue (when the agenda carries
 * it) and the week's seven days, Sunday first. A day the workweek setting hides
 * is left out unless something is due on it, so no task drops off the board.
 */
export function boardColumns(
  groups: AgendaGroup[],
  window: WeekWindow,
  workdays: readonly number[],
  includeOverdue: boolean,
): BoardColumn[] {
  const byDate = new Map<string, Task[]>();
  let overdue: Task[] = [];
  for (const g of groups) {
    if (g.key === OVERDUE) {
      overdue = dueIssues(g);
      continue;
    }
    for (const task of dueIssues(g)) {
      const list = byDate.get(task.dueDate!) ?? [];
      list.push(task);
      byDate.set(task.dueDate!, list);
    }
  }

  const columns: BoardColumn[] = [];
  if (includeOverdue) {
    columns.push({ key: OVERDUE, date: null, label: "overdue", cards: [...overdue].sort(byDueDate) });
  }
  for (let day = 0; day < 7; day++) {
    const date = addDays(window.weekStart, day);
    const cards = (byDate.get(date) ?? []).sort(byPriority);
    if (!workdays.includes(day) && cards.length === 0) continue;
    columns.push({ key: date, date, label: dayLabel(date), cards });
  }
  return columns;
}

/**
 * The day a card lands on when moved one step with the keyboard: the next or
 * previous day column on the board. Overdue is never a target; a card moved
 * right out of Overdue lands on the first day from today on.
 */
export function stepDay(columns: BoardColumn[], fromKey: string, dir: -1 | 1, today: string): string | null {
  const days = columns.flatMap((c) => (c.date ? [c.date] : []));
  if (fromKey === OVERDUE) return dir === 1 ? (days.find((d) => d >= today) ?? null) : null;
  return days[days.indexOf(fromKey) + dir] ?? null;
}

/** Droppable ids for day columns; Overdue has none, so nothing can be dropped there. */
export const dayDropId = (date: string) => `day:${date}`;

/** The due date a drop sets, or null when the drop changes nothing (no target, same day, unknown task). */
export function dropDueDate(task: Task | undefined, overId: string | null): string | null {
  if (!task || !overId?.startsWith("day:")) return null;
  const date = overId.slice(4);
  return date === task.dueDate ? null : date;
}
