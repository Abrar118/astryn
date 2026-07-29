import type { IssueFilters } from "@/lib/commands";

export type GroupBy = "status" | "assignee" | "priority" | "project" | "none";
export type ViewMode = "list" | "board";
export type Ordering = "status" | "priority" | "dueDate" | "title" | "created" | "updated";
export type Completed = "all" | "active";
export type DisplayKey =
  | "id" | "status" | "priority" | "assignee" | "dueDate" | "project" | "labels"
  | "estimate" | "cycle" | "milestone" | "links" | "pullRequests" | "created" | "updated";
export type DisplayProps = Record<DisplayKey, boolean>;
export type ViewConfig = {
  filters: IssueFilters;
  groupBy: GroupBy;
  viewMode: ViewMode;
  ordering: Ordering;
  completed: Completed;
  showSubIssues: boolean;
  display: DisplayProps;
};

export const VIEW_KEY = "astryn.issues-view";
export const DEFAULT_DISPLAY: DisplayProps = {
  id: true, status: false, priority: true, assignee: true, dueDate: true,
  project: true, labels: true, estimate: false, cycle: false, milestone: false,
  links: false, pullRequests: false, created: false, updated: false,
};
export const DEFAULT_CONFIG: ViewConfig = {
  filters: {}, groupBy: "status", viewMode: "list", ordering: "status",
  completed: "all", showSubIssues: true, display: DEFAULT_DISPLAY,
};

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}

/**
 * Drop persisted filter ids that don't exist in the current workspace. Filters
 * are stored by raw Linear id, so switching workspaces leaves them pointing at
 * entities that match nothing and the list silently renders empty.
 *
 * An empty or absent list means "not loaded yet" (cold start, offline, failed
 * fetch) — never a reason to prune, or a valid filter would be wiped on launch.
 */
export function pruneFilters(
  filters: IssueFilters,
  known: { teams?: { id: string }[]; projects?: { id: string }[]; users?: { id: string }[] },
): IssueFilters {
  const pairs = [
    ["teamId", known.teams],
    ["assigneeId", known.users],
    ["projectId", known.projects],
  ] as const;
  let next = filters;
  for (const [key, list] of pairs) {
    const value = filters[key];
    if (!value || !list?.length) continue;
    if (list.some((entry) => entry.id === value)) continue;
    if (next === filters) next = { ...filters };
    delete next[key];
  }
  return next;
}

export function parseViewConfig(raw: string | null): ViewConfig {
  let value: unknown;
  try { value = JSON.parse(raw ?? "{}"); } catch { return DEFAULT_CONFIG; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_CONFIG;
  const input = value as Record<string, unknown>;
  const rawFilters = input.filters && typeof input.filters === "object" && !Array.isArray(input.filters)
    ? input.filters as Record<string, unknown> : {};
  const filters: IssueFilters = {};
  for (const key of ["teamId", "assigneeId", "projectId"] as const) {
    if (typeof rawFilters[key] === "string" && rawFilters[key]) filters[key] = rawFilters[key];
  }
  const rawDisplay = input.display && typeof input.display === "object" && !Array.isArray(input.display)
    ? input.display as Record<string, unknown> : {};
  const display = { ...DEFAULT_DISPLAY };
  for (const key of Object.keys(display) as DisplayKey[]) {
    if (typeof rawDisplay[key] === "boolean") display[key] = rawDisplay[key];
  }
  return {
    filters,
    groupBy: oneOf(input.groupBy, ["status", "assignee", "priority", "project", "none"], DEFAULT_CONFIG.groupBy),
    viewMode: oneOf(input.viewMode, ["list", "board"], DEFAULT_CONFIG.viewMode),
    ordering: oneOf(input.ordering, ["status", "priority", "dueDate", "title", "created", "updated"], DEFAULT_CONFIG.ordering),
    completed: oneOf(input.completed, ["all", "active"], DEFAULT_CONFIG.completed),
    showSubIssues: typeof input.showSubIssues === "boolean" ? input.showSubIssues : DEFAULT_CONFIG.showSubIssues,
    display,
  };
}
