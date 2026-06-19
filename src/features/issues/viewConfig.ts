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
