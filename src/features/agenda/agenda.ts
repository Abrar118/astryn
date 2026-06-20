import type { IssueListItem, Relation } from "../../lib/commands";
import type { WeekWindow } from "../../lib/dates";

export type AgendaItem = {
  issue: IssueListItem;
  children: IssueListItem[];
  relations: Relation[];
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

function sortItems(items: AgendaItem[]): AgendaItem[] {
  return items.sort(
    (a, b) =>
      prioRank(a.issue.priority) - prioRank(b.issue.priority) ||
      a.issue.identifier.localeCompare(b.issue.identifier),
  );
}

export function buildAgenda(args: {
  issues: IssueListItem[];
  relations: Relation[];
  viewerId: string;
  window: WeekWindow;
}): AgendaGroup[] {
  const { issues, relations, viewerId, window } = args;

  const relationsByIssue = new Map<string, Relation[]>();
  for (const r of relations) {
    const list = relationsByIssue.get(r.issueId) ?? [];
    list.push(r);
    relationsByIssue.set(r.issueId, list);
  }

  const childrenByParent = new Map<string, IssueListItem[]>();
  for (const i of issues) {
    if (!i.parentId) continue;
    const list = childrenByParent.get(i.parentId) ?? [];
    list.push(i);
    childrenByParent.set(i.parentId, list);
  }

  // Top-level candidates: the viewer's dated issues.
  const mine = issues.filter((i) => i.assigneeId === viewerId && i.dueDate);

  // Dedup: a candidate that is a child of another candidate shows nested only.
  const childIds = new Set<string>();
  for (const c of mine) {
    for (const kid of childrenByParent.get(c.id) ?? []) childIds.add(kid.id);
  }
  const topLevel = mine.filter((i) => !childIds.has(i.id));

  const toItem = (issue: IssueListItem): AgendaItem => ({
    issue,
    children: childrenByParent.get(issue.id) ?? [],
    relations: relationsByIssue.get(issue.id) ?? [],
  });

  const overdue = topLevel.filter(
    (i) =>
      i.dueDate! < window.weekStart &&
      i.stateType !== "completed" &&
      i.stateType !== "canceled",
  );
  const weekendItems = topLevel.filter((i) => window.weekend.includes(i.dueDate!));

  const groups: AgendaGroup[] = [];
  if (overdue.length) {
    groups.push({ key: "overdue", label: "Overdue", date: null, items: sortItems(overdue.map(toItem)) });
  }
  window.weekdays.forEach((date, idx) => {
    const items = topLevel.filter((i) => i.dueDate === date).map(toItem);
    groups.push({ key: date, label: WEEKDAY_LABELS[idx], date, items: sortItems(items) });
  });
  if (weekendItems.length) {
    groups.push({ key: "weekend", label: "Weekend", date: null, items: sortItems(weekendItems.map(toItem)) });
  }
  return groups;
}
