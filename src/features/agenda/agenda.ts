import type { IssueListItem } from "../../lib/commands";
import type { WeekWindow } from "../../lib/dates";

export type AgendaItem = {
  /** The top-level issue of this row — a due issue, or a parent shown for context. */
  issue: IssueListItem;
  /** True when `issue` is only a heading for its due sub-issues and is not
   *  itself due in this group (due elsewhere, or not the viewer's). */
  contextOnly: boolean;
  /** The viewer's sub-issues due in this group, nested under `issue`. */
  children: IssueListItem[];
};

export type AgendaGroup = {
  /** "overdue" | a weekday date string | "weekend". */
  key: string;
  label: string;
  /** The weekday date for day groups; null for overdue/weekend. */
  date: string | null;
  items: AgendaItem[];
};

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"];

/** Sort rank: urgent(1) first, none(0) last. */
const prioRank = (p: number) => (p === 0 ? 5 : p);

/** An item's rank is its most urgent due issue (context parents rank by children). */
const itemRank = (it: AgendaItem) =>
  Math.min(
    ...(it.contextOnly ? [] : [prioRank(it.issue.priority)]),
    ...it.children.map((c) => prioRank(c.priority)),
  );

function sortItems(items: AgendaItem[]): AgendaItem[] {
  for (const it of items) {
    it.children.sort(
      (a, b) => prioRank(a.priority) - prioRank(b.priority) || a.identifier.localeCompare(b.identifier),
    );
  }
  return [...items].sort(
    (a, b) => itemRank(a) - itemRank(b) || a.issue.identifier.localeCompare(b.issue.identifier),
  );
}

/** The issues actually due in a group — top-level due issues plus nested children,
 *  excluding context-only parent headings. */
export function dueIssues(group: AgendaGroup): IssueListItem[] {
  return group.items.flatMap((it) => (it.contextOnly ? it.children : [it.issue, ...it.children]));
}

export function buildAgenda(args: {
  issues: IssueListItem[];
  viewerId: string;
  window: WeekWindow;
  includeOverdue?: boolean;
}): AgendaGroup[] {
  const { issues, viewerId, window, includeOverdue = true } = args;

  const byId = new Map(issues.map((i) => [i.id, i]));

  // Every dated issue assigned to the viewer stays in its own due-date bucket —
  // a sub-issue whose parent sits on another day (or is overdue / outside this
  // week) must still appear on its own due date. Nesting happens only WITHIN a
  // bucket: under the parent's row when the parent is due there too, otherwise
  // under a context-only heading for the parent.
  const mine = issues.filter((i) => i.assigneeId === viewerId && i.dueDate);

  const toItems = (due: IssueListItem[]): AgendaItem[] => {
    const dueById = new Map(due.map((i) => [i.id, i]));

    // One nesting level: a due issue nests iff its parent is due here AND that
    // parent renders top-level itself. Memoized; the self-seed breaks parent cycles.
    const nestedMemo = new Map<string, boolean>();
    const isNested = (i: IssueListItem): boolean => {
      const memo = nestedMemo.get(i.id);
      if (memo !== undefined) return memo;
      nestedMemo.set(i.id, false);
      const parent = i.parentId ? dueById.get(i.parentId) : undefined;
      const nested = !!parent && !isNested(parent);
      nestedMemo.set(i.id, nested);
      return nested;
    };

    const items = new Map<string, AgendaItem>();
    const itemFor = (issue: IssueListItem, contextOnly: boolean): AgendaItem => {
      let item = items.get(issue.id);
      if (!item) {
        item = { issue, contextOnly, children: [] };
        items.set(issue.id, item);
      }
      return item;
    };

    for (const i of due) {
      if (isNested(i)) {
        itemFor(dueById.get(i.parentId!)!, false).children.push(i);
        continue;
      }
      const parent = i.parentId ? byId.get(i.parentId) : undefined;
      if (parent && !dueById.has(parent.id)) {
        itemFor(parent, true).children.push(i);
      } else {
        itemFor(i, false);
      }
    }
    return sortItems([...items.values()]);
  };

  const overdue = mine.filter(
    (i) =>
      i.dueDate! < window.weekStart &&
      i.stateType !== "completed" &&
      i.stateType !== "canceled",
  );
  const weekendItems = mine.filter((i) => window.weekend.includes(i.dueDate!));

  const groups: AgendaGroup[] = [];
  if (includeOverdue && overdue.length) {
    groups.push({ key: "overdue", label: "Overdue", date: null, items: toItems(overdue) });
  }
  window.weekdays.forEach((date, idx) => {
    const items = mine.filter((i) => i.dueDate === date);
    groups.push({ key: date, label: WEEKDAY_LABELS[idx], date, items: toItems(items) });
  });
  if (weekendItems.length) {
    groups.push({ key: "weekend", label: "Weekend", date: null, items: toItems(weekendItems) });
  }
  return groups;
}
