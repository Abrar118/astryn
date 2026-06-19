import { invoke } from "@tauri-apps/api/core";

export type ConnectionStatus =
  | { state: "not_configured" }
  | { state: "unverified" }
  | { state: "connected"; name: string };

export const setLinearKey = (key: string): Promise<void> =>
  invoke("set_linear_key", { key });

export const clearLinearKey = (): Promise<void> =>
  invoke("clear_linear_key");

export const getConnectionStatus = (): Promise<ConnectionStatus> =>
  invoke("get_connection_status");

export const testLinearConnection = (): Promise<ConnectionStatus> =>
  invoke("test_linear_connection");

/// Tauri commands reject with the backend's already-sanitized `CmdError` string
/// (e.g. "Linear rate limit reached. Try again shortly."). Normalize whatever the
/// IPC layer throws into a safe, human-readable line for a toast description.
export function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "Unexpected error. Please try again.";
}

// ── M1 types ──────────────────────────────────────────────────────────────────

export type CalendarIssue = {
  id: string;
  identifier: string;
  title: string;
  dueDate: string | null;
  priority: number;
  stateType: string;
  stateColor: string;
  assigneeId: string | null;
  teamId: string | null;
  teamKey: string | null;
  projectId: string | null;
};

export type Issue = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: number;
  url: string;
  stateId: string | null;
  stateName: string | null;
  stateType: string;
  stateColor: string;
  assigneeId: string | null;
  assigneeName: string | null;
  teamId: string | null;
  teamKey: string | null;
  projectId: string | null;
  projectName: string | null;
  parentId: string | null;
  estimate: number | null;
  cycleName: string | null;
  cycleNumber: number | null;
  milestoneName: string | null;
  linkCount: number;
  prCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Label = { id: string; name: string | null; color: string | null };

/** A list-view issue: the cached read-shape plus its labels. */
export type IssueListItem = Issue & { labels: Label[] };
export type DetailState = { id: string; name: string; type: string; color: string };
export type DetailCycle = { id: string; number: number | null; name: string | null };
export type DetailRef = { id: string; identifier: string; title: string };
export type DetailChild = { id: string; identifier: string; title: string; stateType: string };
export type DetailRelation = { type: string; issue: DetailRef };
export type DetailComment = { id: string; body: string; userName: string | null; createdAt: string };

export type LiveDetail = Issue & {
  labels: Label[];
  teamStates: DetailState[];
  cycle: DetailCycle | null;
  parent: DetailRef | null;
  children: DetailChild[];
  relations: DetailRelation[];
  comments: DetailComment[];
  hasMoreChildren: boolean;
  hasMoreRelations: boolean;
  hasMoreComments: boolean;
};

// "preview" is frontend-only (placeholder); the command returns "live" | "cache".
export type IssueDetailResult =
  | { source: "preview"; detail: CalendarIssue }
  | { source: "cache"; detail: Issue }
  | { source: "live"; detail: LiveDetail };

export type FilterOptions = {
  teams: { id: string; key: string }[];
  projects: { id: string; name: string }[];
};
export type User = { id: string; name: string; avatarUrl: string | null };
export type Me = { viewerId: string; viewerName: string };
export type SyncResult = { mode: "full" | "incremental"; synced: number };

export type IssueFilters = {
  teamId?: string;
  assigneeId?: string;
  projectId?: string;
};

export type UpdateIssuePatch = {
  title?: string;
  stateId?: string;
  priority?: number;
  dueDate?: string | null;
  assigneeId?: string | null;
  description?: string | null;
  labelIds?: string[];
  projectId?: string | null;
  estimate?: number | null;
  cycleId?: string | null;
};

export type Cycle = { id: string; number: number | null; name: string | null; teamId: string | null };

// ── M1 bindings ───────────────────────────────────────────────────────────────

export const syncIssues = (full = false): Promise<SyncResult> =>
  invoke("sync_issues", { full });

export const listCalendarIssues = (
  args: { start: string; end: string } & IssueFilters,
): Promise<CalendarIssue[]> => invoke("list_calendar_issues", { args });

export const listUnscheduled = (args: IssueFilters): Promise<CalendarIssue[]> =>
  invoke("list_unscheduled", { args });

export const listIssues = (args: IssueFilters): Promise<IssueListItem[]> =>
  invoke("list_issues", { args });

export const listFilterOptions = (): Promise<FilterOptions> =>
  invoke("list_filter_options");

export const getIssueDetail = (id: string): Promise<IssueDetailResult> =>
  invoke("get_issue_detail", { id });

export const updateIssue = (id: string, patch: UpdateIssuePatch): Promise<Issue> =>
  invoke("update_issue", { id, patch });

export const listUsers = (): Promise<User[]> => invoke("list_users");

export const listLabels = (): Promise<Label[]> => invoke("list_labels");

export const listCycles = (): Promise<Cycle[]> => invoke("list_cycles");

export const deleteIssue = (id: string): Promise<void> => invoke("delete_issue", { id });

export const getMe = (): Promise<Me | null> => invoke("get_me");
