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
  attachmentsTruncated: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Label = { id: string; name: string | null; color: string | null };

/** A list-view issue: the cached read-shape plus its labels. */
export type IssueListItem = Issue & { labels: Label[] };
export type DetailState = { id: string; name: string; type: string; color: string };
export type DetailCycle = { id: string; number: number | null; name: string | null };
export type DetailRef = {
  id: string;
  identifier: string;
  title: string;
  /** Workflow-state of the referenced issue; present on relations, absent on parent. */
  stateType?: string;
  stateColor?: string;
};
export type DetailChild = {
  id: string;
  identifier: string;
  title: string;
  stateType: string;
  stateName: string;
  stateColor: string;
  priority: number;
  dueDate: string | null;
  estimate: number | null;
  assigneeName: string | null;
  projectName: string | null;
  cycleName: string | null;
  cycleNumber: number | null;
};
export type DetailRelation = { type: string; issue: DetailRef };
export type DetailReaction = { id: string; emoji: string; userId: string | null; userName: string | null };
export type DetailComment = {
  id: string;
  body: string;
  userId: string | null;
  userName: string | null;
  createdAt: string;
  editedAt: string | null;
  parentId: string | null;
  reactions: DetailReaction[];
};
export type DetailAttachment = {
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
  sourceType: string | null;
  createdAt: string;
  body: string | null;
};
export type DetailRelationChange = { type: string; identifier: string };
export type DetailHistory = {
  id: string;
  createdAt: string;
  actorName: string | null;
  fromStateName: string | null;
  toStateName: string | null;
  fromAssigneeName: string | null;
  toAssigneeName: string | null;
  fromPriority: number | null;
  toPriority: number | null;
  fromTitle: string | null;
  toTitle: string | null;
  updatedDescription: boolean;
  attachment: DetailAttachment | null;
  relationChanges: DetailRelationChange[];
};

export type LiveDetail = Issue & {
  labels: Label[];
  teamStates: DetailState[];
  cycle: DetailCycle | null;
  parent: DetailRef | null;
  creatorName: string | null;
  children: DetailChild[];
  relations: DetailRelation[];
  attachments: DetailAttachment[];
  history: DetailHistory[];
  comments: DetailComment[];
  hasMoreChildren: boolean;
  hasMoreRelations: boolean;
  hasMoreHistory: boolean;
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
export type User = { id: string; name: string };
export type Me = { viewerId: string; viewerName: string };
export type SyncResult = { mode: "full" | "incremental"; synced: number };

export type IssueFilters = {
  teamId?: string;
  assigneeId?: string;
  projectId?: string;
};

export type UpdateIssuePatch = {
  title?: string;
  teamId?: string;
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
export type WorkflowState = { id: string; name: string; type: string; color: string; teamId: string };

export type CreateIssueInput = {
  teamId: string;
  title: string;
  description?: string | null;
  stateId?: string | null;
  priority?: number;
  dueDate?: string | null;
  assigneeId?: string | null;
  labelIds?: string[];
  projectId?: string | null;
  estimate?: number | null;
  cycleId?: string | null;
};

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

export const loadLinearImage = (url: string): Promise<string> =>
  invoke("load_linear_image", { url });

export const updateIssue = (id: string, patch: UpdateIssuePatch): Promise<Issue> =>
  invoke("update_issue", { id, patch });

export const createIssue = (input: CreateIssueInput): Promise<Issue> =>
  invoke("create_issue", { input });

export const listUsers = (): Promise<User[]> => invoke("list_users");

export const listLabels = (): Promise<Label[]> => invoke("list_labels");

export const listCycles = (): Promise<Cycle[]> => invoke("list_cycles");

export const listWorkflowStates = (): Promise<WorkflowState[]> => invoke("list_workflow_states");

export const deleteIssue = (id: string): Promise<void> => invoke("delete_issue", { id });

export const getMe = (): Promise<Me | null> => invoke("get_me");

export const createComment = (
  issueId: string,
  body: string,
  parentId?: string | null,
): Promise<DetailComment> => invoke("create_comment", { issueId, body, parentId: parentId ?? null });

export const updateComment = (id: string, body: string): Promise<DetailComment> =>
  invoke("update_comment", { id, body });

export const deleteComment = (id: string): Promise<void> => invoke("delete_comment", { id });

export const addReaction = (commentId: string, emoji: string): Promise<DetailReaction> =>
  invoke("add_reaction", { commentId, emoji });

export const removeReaction = (id: string): Promise<void> => invoke("remove_reaction", { id });
