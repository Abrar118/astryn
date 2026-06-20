import type { CalendarIssue, IssueFilters, IssueListItem, UpdateIssuePatch } from "./commands";

/** Does this issue satisfy the (sparse) filter set? Unset filter fields match all. */
export function matchesFilters(i: CalendarIssue, f: IssueFilters): boolean {
  if (f.teamId && i.teamId !== f.teamId) return false;
  if (f.assigneeId && i.assigneeId !== f.assigneeId) return false;
  if (f.projectId && i.projectId !== f.projectId) return false;
  return true;
}

/** Half-open membership: [start, end), null never in range. */
export function inRange(dueDate: string | null, start: string, end: string): boolean {
  return dueDate !== null && dueDate >= start && dueDate < end;
}

/** Insert/update the issue when it belongs, else remove it. Pure, id-keyed. */
export function reconcileList<T extends { id: string }>(
  list: T[],
  issue: T,
  belongs: boolean,
): T[] {
  const without = list.filter((i) => i.id !== issue.id);
  return belongs ? [...without, issue] : without;
}

export function calendarIssueFromList(issue: IssueListItem): CalendarIssue {
  const {
    id, identifier, title, dueDate, priority, stateType, stateColor,
    assigneeId, teamId, teamKey, projectId,
  } = issue;
  return { id, identifier, title, dueDate, priority, stateType, stateColor, assigneeId, teamId, teamKey, projectId };
}

/** Apply only the CalendarIssue-visible fields of a patch onto a base issue. Pure. */
export function applyPatchToCalendarIssue(base: CalendarIssue, patch: UpdateIssuePatch): CalendarIssue {
  return {
    ...base,
    ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.assigneeId !== undefined ? { assigneeId: patch.assigneeId } : {}),
    ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
    ...(patch.teamId !== undefined ? { teamId: patch.teamId } : {}),
  };
}
