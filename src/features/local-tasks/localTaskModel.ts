/** Pure helpers behind the local-tasks views (grouping, filtering, sorting, timeline geometry). */
import type { LocalStatus, LocalTask, LocalTree } from "@/lib/commands";
import { addDays } from "@/lib/dates";
import { LOCAL_ME } from "@/lib/tracker";

/** A list's workflow: its own statuses when it overrides the space's, else the space's. */
export function statusesForList(tree: LocalTree | undefined, listId: string): LocalStatus[] {
  if (!tree) return [];
  const list = tree.lists.find((l) => l.id === listId);
  if (!list) return [];
  const own = tree.statuses.filter((s) => s.scopeId === list.id);
  const statuses = own.length > 0 ? own : tree.statuses.filter((s) => s.scopeId === list.spaceId);
  return [...statuses].sort((a, b) => a.position - b.position);
}

export function isClosed(t: Pick<LocalTask, "stateType">): boolean {
  return t.stateType === "completed" || t.stateType === "canceled";
}

const byPosition = (a: LocalTask, b: LocalTask) => a.position - b.position || a.identifier.localeCompare(b.identifier);

/** Tasks shown at the top level: no parent, or a parent outside `tasks`. */
export function topLevel(tasks: LocalTask[]): LocalTask[] {
  const ids = new Set(tasks.map((t) => t.id));
  return tasks.filter((t) => !t.parentId || !ids.has(t.parentId));
}

export function subtasksOf(tasks: LocalTask[], parentId: string): LocalTask[] {
  return tasks.filter((t) => t.parentId === parentId).sort(byPosition);
}

export type StatusGroup = { status: LocalStatus; tasks: LocalTask[] };

/** Top-level tasks per status, in workflow order; a task with an unknown status joins the first group. */
export function groupByStatus(tasks: LocalTask[], statuses: LocalStatus[]): StatusGroup[] {
  if (statuses.length === 0) return [];
  const groups = statuses.map((status) => ({ status, tasks: [] as LocalTask[] }));
  for (const t of topLevel(tasks)) {
    (groups.find((g) => g.status.id === t.stateId) ?? groups[0]).tasks.push(t);
  }
  for (const g of groups) g.tasks.sort(byPosition);
  return groups;
}

export type ViewFilters = { showClosed: boolean; mineOnly?: boolean; sprintId?: string | null };

export function visibleTasks(tasks: LocalTask[], f: ViewFilters): LocalTask[] {
  return tasks.filter(
    (t) =>
      (f.showClosed || !isClosed(t)) &&
      (!f.mineOnly || t.assigneeId === LOCAL_ME) &&
      (!f.sprintId || t.sprintId === f.sprintId),
  );
}

export type SortKey = "identifier" | "title" | "status" | "priority" | "due" | "start" | "estimate" | "sprint";
export type SortDir = "asc" | "desc";

const PRIORITY_RANK = (p: number) => (p === 0 ? 5 : p);
const CATEGORY_RANK: Record<string, number> = { backlog: 0, unstarted: 1, started: 2, completed: 3, canceled: 4 };

/** Sort for the table view; empty values always sort last. */
export function sortTasks(tasks: LocalTask[], key: SortKey, dir: SortDir): LocalTask[] {
  const value = (t: LocalTask): string | number | null => {
    switch (key) {
      case "identifier": return t.identifier;
      case "title": return t.title.toLowerCase();
      case "status": return (CATEGORY_RANK[t.stateType] ?? 9) * 1000 + (t.stateName ? t.stateName.charCodeAt(0) : 0);
      case "priority": return PRIORITY_RANK(t.priority);
      case "due": return t.dueDate;
      case "start": return t.startDate;
      case "estimate": return t.estimate;
      case "sprint": return t.cycleNumber;
    }
  };
  const sign = dir === "asc" ? 1 : -1;
  return [...tasks].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return a.identifier.localeCompare(b.identifier);
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return sign * cmp || a.identifier.localeCompare(b.identifier);
  });
}

/** A short list key from a name: initials of several words, else the first letters. */
export function suggestKey(name: string, taken: string[]): string {
  const words = name.toUpperCase().match(/[A-Z][A-Z0-9]*/g) ?? [];
  let base = words.length > 1 ? words.map((w) => w[0]).join("").slice(0, 4) : (words[0] ?? "").slice(0, 4);
  if (!base) base = "L";
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base.slice(0, 5)}${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return base;
}

/** A sort position before `next` (and after `prev`, when given). */
export function positionBefore(prev: number | undefined, next: number | undefined): number {
  if (prev === undefined && next === undefined) return 1;
  if (prev === undefined) return (next as number) - 1;
  if (next === undefined) return prev + 1;
  return (prev + next) / 2;
}

const DAY_MS = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

function sundayOnOrBefore(d: string): string {
  return addDays(d, -new Date(utc(d)).getUTCDay());
}

/** Whole weeks covering every dated task and today, with a week before and two after. */
export function timelineRange(tasks: LocalTask[], today: string): { start: string; days: number } {
  const dates = [today, ...tasks.flatMap((t) => [t.startDate, t.dueDate].filter((d): d is string => !!d))].sort();
  const start = sundayOnOrBefore(addDays(dates[0], -7));
  const end = addDays(dates[dates.length - 1], 14);
  const days = Math.max(42, Math.ceil((daysBetween(start, end) + 1) / 7) * 7);
  return { start, days };
}

/** Bar geometry in days from `rangeStart`; a single date (or a start after the due date) is a one-day bar. */
export function barFor(t: LocalTask, rangeStart: string): { offset: number; span: number } | null {
  const end = t.dueDate ?? t.startDate;
  if (!end) return null;
  const start = t.startDate && t.dueDate && t.startDate <= t.dueDate ? t.startDate : end;
  return { offset: daysBetween(rangeStart, start), span: daysBetween(start, end) + 1 };
}
