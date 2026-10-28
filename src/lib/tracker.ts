/**
 * Tracker-neutral task model (module spec 3). Calendar, This Week,
 * Dependencies, the task drawer, Reports and the Dashboard read tasks through
 * this registry so several trackers (Linear, local tasks, …) can be merged.
 * See docs/superpowers/specs/2026-10-28-swappable-tracker-design.md.
 */
import {
  createIssueRelation,
  deleteIssue,
  getMe,
  listCalendarIssues,
  listFilterOptions,
  listIssues,
  listRelations,
  listUnscheduled,
  listUsers,
  listWorkflowStates,
  updateIssue,
  type CalendarIssue,
  type FilterOptions,
  type IssueFilters,
  type IssueListItem,
  type Me,
  type ModuleId,
  type Relation,
  type RelationType,
  type UpdateIssuePatch,
  type User,
  type WorkflowState,
} from "./commands";

/** Every tracker the app can merge. Ids of non-Linear trackers carry a prefix (see `trackerOf`). */
export type TrackerId = "linear";

/** A task row. Field meanings are tracker-neutral (team = workflow scope, cycle = iteration, …). */
export type Task = IssueListItem;
/** The light row the calendar and unscheduled rail render. */
export type TaskSummary = CalendarIssue;
export type TaskRelation = Relation;
/** A status; `type` is its category and `teamId` the workflow scope that owns it. */
export type TaskStatus = WorkflowState;
export type TaskPatch = UpdateIssuePatch;
/** `assigneeId` may be `ME`, meaning "the viewer, in every tracker". */
export type TaskFilters = IssueFilters;
export type StatusCategory = "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled";

/** Filter sentinel: assigned to the viewer of each tracker. */
export const ME = "@me";

export const TRACKERS: Record<TrackerId, { module: ModuleId; label: string }> = {
  linear: { module: "linear", label: "Linear" },
};

export const TRACKER_IDS = Object.keys(TRACKERS) as TrackerId[];

/** The tracker that owns a task id. Linear ids are bare; other trackers prefix theirs. */
export function trackerOf(_id: string): TrackerId {
  return "linear";
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
};

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
  },
};
