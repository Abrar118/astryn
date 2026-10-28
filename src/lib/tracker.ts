/**
 * Tracker-neutral task model (module spec 3). Calendar, This Week,
 * Dependencies, the task drawer, Reports and the Dashboard read tasks through
 * this registry so several trackers (Linear, local tasks, …) can be merged.
 * See docs/superpowers/specs/2026-10-28-swappable-tracker-design.md.
 */
import {
  createIssueRelation,
  createLocalRelation,
  deleteIssue,
  deleteLocalTask,
  getMe,
  listCalendarIssues,
  listFilterOptions,
  listIssues,
  listLocalCalendar,
  listLocalFilterOptions,
  listLocalRelations,
  listLocalStatuses,
  listLocalTasks,
  listLocalUnscheduled,
  listRelations,
  listUnscheduled,
  listUsers,
  listWorkflowStates,
  updateIssue,
  updateLocalTask,
  type CalendarIssue,
  type FilterOptions,
  type IssueDetailResult,
  type IssueFilters,
  type IssueListItem,
  type LiveDetail,
  type LocalTaskDetail,
  type Me,
  type ModuleId,
  type Relation,
  type RelationType,
  type UpdateIssuePatch,
  type User,
  type WorkflowState,
} from "./commands";

/** Every tracker the app can merge. Ids of non-Linear trackers carry a prefix (see `trackerOf`). */
export type TrackerId = "linear" | "local-tasks";

/** Local-task ids (tasks, lists, statuses, …) start with this. */
export const LOCAL_PREFIX = "lt_";
/** The local tracker's viewer: local tasks "assigned to me" carry this assignee id. */
export const LOCAL_ME = "lt_me";

/** A task row. Field meanings are tracker-neutral (team = workflow scope, cycle = iteration, …). */
export type Task = IssueListItem;
/** The light row the calendar and unscheduled rail render. */
export type TaskSummary = CalendarIssue;
export type TaskRelation = Relation;
/** A status; `type` is its category and `teamId` the workflow scope that owns it. */
export type TaskStatus = WorkflowState;
/** The neutral patch; `startDate`/`position` only apply to trackers that have them (local tasks). */
export type TaskPatch = UpdateIssuePatch & { startDate?: string | null; position?: number };
/** `assigneeId` may be `ME`, meaning "the viewer, in every tracker". */
export type TaskFilters = IssueFilters;
export type StatusCategory = "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled";

/** Filter sentinel: assigned to the viewer of each tracker. */
export const ME = "@me";

export const TRACKERS: Record<TrackerId, { module: ModuleId; label: string }> = {
  linear: { module: "linear", label: "Linear" },
  "local-tasks": { module: "local-tasks", label: "Local tasks" },
};

export const TRACKER_IDS = Object.keys(TRACKERS) as TrackerId[];

/** The tracker that owns a task (or user/status) id. Linear ids are bare; other trackers prefix theirs. */
export function trackerOf(id: string): TrackerId {
  return id.startsWith(LOCAL_PREFIX) ? "local-tasks" : "linear";
}

/** True while at least one tracker module is active (the `tracker` capability). */
export function trackerModulesActive(isActive: (id: ModuleId) => boolean): boolean {
  return TRACKER_IDS.some((t) => isActive(TRACKERS[t].module));
}

/**
 * Concrete filters for one tracker: `ME` becomes that tracker's viewer id.
 * Null when the tracker has no known viewer, i.e. nothing of it can be "mine".
 */
export function resolveFilters(
  tracker: TrackerId,
  filters: TaskFilters,
  viewerIds: Partial<Record<TrackerId, string>>,
): TaskFilters | null {
  if (filters.assigneeId !== ME) return filters;
  const viewer = viewerIds[tracker];
  return viewer ? { ...filters, assigneeId: viewer } : null;
}

export type TrackerAdapter = {
  listTasks: (filters: TaskFilters) => Promise<Task[]>;
  listCalendar: (args: { start: string; end: string } & TaskFilters) => Promise<TaskSummary[]>;
  listUnscheduled: (filters: TaskFilters) => Promise<TaskSummary[]>;
  listRelations: () => Promise<TaskRelation[]>;
  listFilterOptions: () => Promise<FilterOptions>;
  listStatuses: () => Promise<TaskStatus[]>;
  listUsers: () => Promise<User[]>;
  /** The viewer query; Linear's lives at `["me"]` (comments and sync use it too). */
  viewerKey: readonly unknown[];
  getViewer: () => Promise<Me | null>;
  update: (id: string, patch: TaskPatch) => Promise<unknown>;
  remove: (id: string) => Promise<void>;
  createRelation: (taskId: string, relatedId: string, type: RelationType) => Promise<void>;
  /** Where the task drawer caches this tracker's detail. */
  detailKey: (id: string) => readonly unknown[];
  /** Apply a patch to that cached detail, for optimistic edits. Pure. */
  patchDetail: (cached: unknown, patch: TaskPatch) => unknown;
};

/** Merge a patch's changed fields into a cached Linear detail result (any branch). */
export function patchLinearDetail(cached: unknown, patch: TaskPatch): IssueDetailResult {
  const result = cached as IssueDetailResult;
  const d = { ...(result.detail as Record<string, unknown>) };
  if (patch.title !== undefined) d.title = patch.title;
  if (patch.priority !== undefined) d.priority = patch.priority;
  if (patch.dueDate !== undefined) d.dueDate = patch.dueDate;
  if (patch.assigneeId !== undefined) d.assigneeId = patch.assigneeId;
  if (patch.description !== undefined) d.description = patch.description;
  if (patch.stateId !== undefined) {
    d.stateId = patch.stateId;
    if (result.source === "live") {
      const st = (result.detail as LiveDetail).teamStates.find((s) => s.id === patch.stateId);
      if (st) { d.stateName = st.name; d.stateType = st.type; d.stateColor = st.color; }
    }
  }
  return { ...result, detail: d } as IssueDetailResult;
}

/** Merge a patch's changed fields into a cached local-task detail. */
export function patchLocalDetail(cached: unknown, patch: TaskPatch): LocalTaskDetail {
  const d: LocalTaskDetail = { ...(cached as LocalTaskDetail) };
  if (patch.title !== undefined) d.title = patch.title;
  if (patch.priority !== undefined) d.priority = patch.priority;
  if (patch.dueDate !== undefined) d.dueDate = patch.dueDate;
  if (patch.startDate !== undefined) d.startDate = patch.startDate;
  if (patch.description !== undefined) d.description = patch.description;
  if (patch.estimate !== undefined) d.estimate = patch.estimate;
  if (patch.assigneeId !== undefined) {
    d.assigneeId = patch.assigneeId;
    d.assigneeName = patch.assigneeId ? "Me" : null;
  }
  if (patch.stateId !== undefined) {
    const st = d.statuses.find((s) => s.id === patch.stateId);
    if (st) {
      d.stateId = st.id;
      d.stateName = st.name;
      d.stateType = st.category;
      d.stateColor = st.color;
    }
  }
  return d;
}

// Bindings are wrapped so the commands are only touched when called (tests mock them partially).
export const TRACKER_ADAPTERS: Record<TrackerId, TrackerAdapter> = {
  linear: {
    listTasks: (f) => listIssues(f),
    listCalendar: (a) => listCalendarIssues(a),
    listUnscheduled: (f) => listUnscheduled(f),
    listRelations: () => listRelations(),
    listFilterOptions: () => listFilterOptions(),
    listStatuses: () => listWorkflowStates(),
    listUsers: () => listUsers(),
    viewerKey: ["me"],
    getViewer: () => getMe(),
    update: (id, patch) => updateIssue(id, patch),
    remove: (id) => deleteIssue(id),
    createRelation: (taskId, relatedId, type) => createIssueRelation(taskId, relatedId, type),
    detailKey: (id) => ["issue", id],
    patchDetail: patchLinearDetail,
  },
  "local-tasks": {
    listTasks: (f) => listLocalTasks(f),
    listCalendar: (a) => listLocalCalendar(a),
    listUnscheduled: (f) => listLocalUnscheduled(f),
    listRelations: () => listLocalRelations(),
    listFilterOptions: () => listLocalFilterOptions(),
    listStatuses: () => listLocalStatuses(),
    listUsers: async () => [{ id: LOCAL_ME, name: "Me" }],
    viewerKey: ["local-tasks", "viewer"],
    // No display name: the greeting keeps another tracker's name or stays generic.
    getViewer: async () => ({ viewerId: LOCAL_ME, viewerName: "" }),
    update: (id, patch) => updateLocalTask(id, patch),
    remove: (id) => deleteLocalTask(id),
    createRelation: (taskId, relatedId, type) =>
      type === "duplicate"
        ? Promise.reject("Local tasks can be linked as blocking or related.")
        : createLocalRelation(taskId, relatedId, type),
    detailKey: (id) => ["local-task", id],
    patchDetail: patchLocalDetail,
  },
};
