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
  /** When the issue first entered a "started" state (Linear `startedAt`); null if never started. */
  startedAt: string | null;
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

export type Relation = {
  issueId: string;
  type: string;
  relatedId: string;
  relatedIdentifier: string | null;
  relatedTitle: string | null;
  relatedStateName: string | null;
  relatedStateType: string | null;
  relatedStateColor: string | null;
};

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
  /** Document text the comment references (inline comments only, else null). */
  quotedText: string | null;
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
  toStateType: string | null;
  toStateColor: string | null;
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
  branchName: string | null;
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
export type User = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  displayName?: string | null;
  timezone?: string | null;
  teamName?: string | null;
};

/** An inbox notification, flattened to the issue it points at. */
export type Notification = {
  id: string;
  /** Linear notification `type` (drives the human subtitle). */
  kind: string;
  createdAt: string;
  read: boolean;
  actorName: string | null;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  issueStateType: string;
  issueStateColor: string;
  issueProjectName: string | null;
};

/** A page of inbox notifications; `hasMore` flags older items beyond the cap. */
export type NotificationsPage = { notifications: Notification[]; hasMore: boolean };
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
  parentId?: string | null;
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

export const listRelations = (): Promise<Relation[]> => invoke("list_relations");

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

export const listNotifications = (): Promise<NotificationsPage> => invoke("list_notifications");

export const listLabels = (): Promise<Label[]> => invoke("list_labels");

export const listCycles = (): Promise<Cycle[]> => invoke("list_cycles");

export const listWorkflowStates = (): Promise<WorkflowState[]> => invoke("list_workflow_states");

export const deleteIssue = (id: string): Promise<void> => invoke("delete_issue", { id });

/** Linear relation type from the source issue's perspective. */
export type RelationType = "related" | "blocks" | "duplicate";

export const createIssueRelation = (
  issueId: string,
  relatedIssueId: string,
  type: RelationType,
): Promise<void> => invoke("create_issue_relation", { issueId, relatedIssueId, type });

/** Link a URL (or a GitHub PR's URL) to an issue as a Linear attachment. */
export const createAttachmentLink = (
  issueId: string,
  url: string,
  title?: string | null,
): Promise<DetailAttachment> =>
  invoke("create_attachment_link", { issueId, url, title: title ?? null });

/** A file uploaded to Linear storage, ready to embed in markdown. */
export type UploadedAsset = {
  url: string;
  filename: string;
  contentType: string;
  isImage: boolean;
  size: number;
};

/** Outcome of a (possibly multi-file) upload: successful assets + a count of
 *  selected files that were skipped (failed), for partial-success warnings. */
export type UploadOutcome = {
  assets: UploadedAsset[];
  skipped: number;
};

/** Open the native file picker and upload the chosen files to Linear storage.
 *  The picker runs in Rust; no path is passed from the webview. */
export const uploadFiles = (): Promise<UploadOutcome> => invoke("upload_file");

/** Rename an attachment. */
export const updateAttachment = (id: string, title: string): Promise<DetailAttachment> =>
  invoke("update_attachment", { id, title });

/** Delete an attachment. */
export const deleteAttachment = (id: string): Promise<void> => invoke("delete_attachment", { id });

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

export const createLabel = (name: string, teamId: string | null, color: string): Promise<Label> =>
  invoke("create_label", { name, teamId, color });

export type LinkPreview = {
  requestedUrl: string;
  resolvedUrl: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageDataUrl: string | null;
};

export const fetchLinkPreview = (url: string): Promise<LinkPreview> =>
  invoke("fetch_link_preview", { url });

// ── M4 GitHub PR dashboard ──────────────────────────────────────────────────

export type GitHubStatus =
  | { state: "not_configured" }
  | { state: "unverified" }
  | { state: "connected"; login: string };

export type PrBucket = "needs_review" | "mine" | "assigned" | "involved" | "merged";

export type PrReviewer = {
  login: string;
  avatar: string | null;
  state: "approved" | "changes_requested" | "commented" | "dismissed" | "pending";
};

export type GithubPr = {
  id: string;
  bucket: PrBucket;
  repo: string;
  number: number;
  title: string | null;
  draft: boolean;
  mergeable: "mergeable" | "conflicting" | "unknown" | null;
  ciStatus: "success" | "failure" | "pending" | "none" | null;
  reviewDecision: "approved" | "changes_requested" | "review_required" | null;
  authorLogin: string | null;
  authorAvatar: string | null;
  commentCount: number | null;
  branch: string | null;
  baseBranch: string | null;
  url: string | null;
  linearIdentifier: string | null;
  linearIssueId: string | null;
  updatedAt: string | null;
  mergedAt: string | null;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  linearStateName: string | null;
  linearStateType: string | null;
  linearStateColor: string | null;
  linearPriority: number | null;
  reviewers: PrReviewer[];
};

export type GithubSyncMeta = {
  bucket: PrBucket;
  fetchedCount: number;
  truncated: boolean;
  lastSyncedAt: string | null;
};

export type PrDashboard = { prs: GithubPr[]; meta: GithubSyncMeta[] };
export type BucketSyncResult = { bucket: PrBucket; ok: boolean; truncated: boolean };

export const setGithubToken = (token: string): Promise<void> =>
  invoke("set_github_token", { token });

export const clearGithubToken = (): Promise<void> => invoke("clear_github_token");

export const getGithubStatus = (): Promise<GitHubStatus> => invoke("get_github_status");

export const testGithubConnection = (): Promise<GitHubStatus> =>
  invoke("test_github_connection");

export const syncGithubPrs = (): Promise<BucketSyncResult[]> => invoke("sync_github_prs");

export const listGithubPrs = (): Promise<PrDashboard> => invoke("list_github_prs");

/** One day of the GitHub contribution calendar. `weekday`: 0 = Sun … 6 = Sat. */
export type ContribDay = { date: string; count: number; weekday: number };
/** The viewer's contribution calendar: total + weeks (oldest→newest, may be partial at edges). */
export type Contributions = { total: number; weeks: ContribDay[][] };

export const getGithubContributions = (): Promise<Contributions | null> =>
  invoke("get_github_contributions");

export const syncGithubContributions = (): Promise<Contributions> =>
  invoke("sync_github_contributions");

// ── Slack catch-up board (Phase 2, iter 1) ───────────────────────────────────

export type SlackStatus =
  | { state: "not_configured" }
  | { state: "unverified" }
  | { state: "connected"; workspaceName: string | null; userName: string };

export type SlackConversation = {
  id: string;
  kind: "channel" | "dm" | "group_dm";
  name: string | null;
  partnerUserId: string | null;
  unreadCount: number;
  hasMention: boolean;
  unreadThreads: number;
  latestTs: string | null;
  latestSnippet: string | null;
};

export type SlackMessage = {
  conversationId: string;
  ts: string;
  threadTs: string | null;
  userId: string | null;
  userName: string | null;
  userAvatar: string | null;
  text: string | null;
  isMention: boolean;
  linearIdentifier: string | null;
  linearIssueId: string | null;
  createdAt: string;
};

export type SlackThread = {
  conversationId: string;
  conversationName: string | null;
  threadTs: string;
  unreadReplies: number;
  hasMention: boolean;
  latestTs: string;
};

export type SlackCatchup = {
  conversations: SlackConversation[];
  mentions: SlackMessage[];
  threads: SlackThread[];
  lastSyncedAt: string | null;
};

export type SlackSyncSummary = { synced: boolean; conversationCount: number; unreadTotal: number };
export type SlackDeepLink = { app: string; web: string };

export const setSlackCredentials = (token: string, cookie?: string | null): Promise<void> =>
  invoke("set_slack_credentials", { token, cookie: cookie ?? null });
export const detectSlackCredentials = (): Promise<SlackStatus> => invoke("detect_slack_credentials");
export const clearSlackToken = (): Promise<void> => invoke("clear_slack_token");
export const getSlackStatus = (): Promise<SlackStatus> => invoke("get_slack_status");
export const testSlackConnection = (): Promise<SlackStatus> => invoke("test_slack_connection");
export const syncSlackCatchup = (): Promise<SlackSyncSummary> => invoke("sync_slack_catchup");
export const getSlackCatchup = (): Promise<SlackCatchup> => invoke("get_slack_catchup");
export const getSlackConversationMessages = (conversationId: string): Promise<SlackMessage[]> =>
  invoke("get_slack_conversation_messages", { conversationId });
export const slackDeepLink = (conversationId: string, ts?: string | null): Promise<SlackDeepLink> =>
  invoke("slack_deep_link", { conversationId, ts: ts ?? null });
