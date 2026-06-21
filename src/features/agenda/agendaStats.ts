import type { IssueListItem } from "../../lib/commands";
import { weekWindow, addDays } from "../../lib/dates";
import { PRIORITY_LABELS, PRIORITY_COLORS, PRIORITY_ORDER, STATE_RANK } from "../issues/IssueRow";
import type { AgendaGroup } from "./agenda";

export type HeatCell = {
  date: string;
  count: number;
  /** Week offset from the current week (0 = this week, -1 = last week, …). */
  offset: number;
};

export type HeatWeek = {
  /** Week offset from the current week. */
  offset: number;
  /** 7 cells in Sun→Sat order. */
  cells: HeatCell[];
};

/**
 * Build a heatmap of the viewer's due issues across a range of weeks.
 * Weeks are ordered oldest→newest (most negative offset first).
 */
export function buildHeatmap(
  issues: IssueListItem[],
  viewerId: string,
  opts: { now: Date; weeksBack: number; weeksForward: number },
): HeatWeek[] {
  const { now, weeksBack, weeksForward } = opts;

  // Pre-build a map: date → count of viewer's issues due on that date.
  const countByDate = new Map<string, number>();
  for (const issue of issues) {
    if (issue.assigneeId !== viewerId || !issue.dueDate) continue;
    countByDate.set(issue.dueDate, (countByDate.get(issue.dueDate) ?? 0) + 1);
  }

  const weeks: HeatWeek[] = [];
  for (let offset = -weeksBack; offset <= weeksForward; offset++) {
    const { weekStart } = weekWindow(now, offset);
    const cells: HeatCell[] = [];
    for (let day = 0; day < 7; day++) {
      const date = addDays(weekStart, day);
      cells.push({ date, count: countByDate.get(date) ?? 0, offset });
    }
    weeks.push({ offset, cells });
  }
  return weeks;
}

export type StatusBreakdownEntry = {
  type: string;
  name: string;
  color: string;
  count: number;
};

/**
 * Group issues by stateType, return entries sorted by STATE_RANK (unknown types last).
 * Uses the stateName/stateColor of the first item in each group.
 */
export function statusBreakdown(items: IssueListItem[]): StatusBreakdownEntry[] {
  const groups = new Map<string, { name: string; color: string; count: number }>();

  for (const item of items) {
    const existing = groups.get(item.stateType);
    if (existing) {
      existing.count++;
    } else {
      groups.set(item.stateType, {
        name: item.stateName ?? item.stateType,
        color: item.stateColor ?? "#6b7280",
        count: 1,
      });
    }
  }

  return Array.from(groups.entries())
    .map(([type, g]) => ({ type, name: g.name, color: g.color, count: g.count }))
    .sort((a, b) => (STATE_RANK[a.type] ?? 9) - (STATE_RANK[b.type] ?? 9));
}

export type PriorityBreakdownEntry = {
  priority: number;
  label: string;
  color: string;
  count: number;
};

/**
 * Group issues by priority, return one entry per bucket that has ≥1 item,
 * ordered Urgent→High→Medium→Low→None.
 */
export function priorityBreakdown(items: IssueListItem[]): PriorityBreakdownEntry[] {
  const countByPriority = new Map<number, number>();
  for (const item of items) {
    countByPriority.set(item.priority, (countByPriority.get(item.priority) ?? 0) + 1);
  }

  return PRIORITY_ORDER.filter((p) => countByPriority.has(p)).map((p) => ({
    priority: p,
    label: PRIORITY_LABELS[p] ?? "Unknown",
    color: PRIORITY_COLORS[p] ?? "#6b7280",
    count: countByPriority.get(p)!,
  }));
}

export type AgendaCounts = {
  todo: number;
  inProgress: number;
  inReview: number;
  overdue: number;
};

/**
 * Tally the week's agenda for the dashboard glance card. The three state
 * buckets count the top-level issue of every group (an "In Review" state is
 * matched by name since Linear models it as a `started` custom state);
 * `overdue` is the size of the Overdue group. State buckets and `overdue` may
 * overlap by design — they answer different questions.
 */
export function agendaCounts(groups: AgendaGroup[]): AgendaCounts {
  let todo = 0;
  let inProgress = 0;
  let inReview = 0;
  let overdue = 0;
  for (const g of groups) {
    if (g.key === "overdue") overdue += g.items.length;
    for (const { issue } of g.items) {
      if ((issue.stateName ?? "").toLowerCase().includes("review")) inReview++;
      else if (issue.stateType === "started") inProgress++;
      else if (issue.stateType === "unstarted") todo++;
    }
  }
  return { todo, inProgress, inReview, overdue };
}
