/**
 * Merged, tracker-neutral task queries and routed task mutations (module spec 3).
 * Each hook runs one query per active tracker, keyed `[root, tracker, …]`, and
 * merges the results; writes go to the tracker that owns the task id.
 */
import { useMutation, useQueries, useQueryClient, type QueryKey, type UseQueryResult } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { errorText, type FilterOptions, type Me, type RelationType, type User } from "./commands";
import { useModules } from "./modules";
import { applyPatchToCalendarIssue, calendarIssueFromList, inRange, matchesFilters, reconcileList } from "./optimistic";
import {
  ME,
  TRACKER_ADAPTERS,
  TRACKER_IDS,
  TRACKERS,
  resolveFilters,
  trackerOf,
  type Task,
  type TaskFilters,
  type TaskPatch,
  type TaskRelation,
  type TaskStatus,
  type TaskSummary,
  type TrackerId,
} from "./tracker";

/** Trackers whose module is on, in registry order. */
export function useActiveTrackers(): TrackerId[] {
  const { isActive } = useModules();
  return TRACKER_IDS.filter((t) => isActive(TRACKERS[t].module));
}

export type Merged<T> = { data: T[] | undefined; isLoading: boolean; isError: boolean };

/**
 * Concatenate per-tracker results once each tracker has data or has failed, so
 * one failing tracker never hides another's cached tasks.
 */
export function mergeResults<T>(results: Pick<UseQueryResult<T[]>, "data" | "isError">[]): Merged<T> {
  if (results.length === 0) return { data: undefined, isLoading: false, isError: false };
  const settled = results.every((r) => r.data !== undefined || r.isError);
  return {
    data: settled ? results.flatMap((r) => r.data ?? []) : undefined,
    isLoading: !settled,
    isError: results.some((r) => r.isError),
  };
}

export type Viewer = {
  /** Each active tracker's viewer id (absent until known). */
  ids: Partial<Record<TrackerId, string>>;
  viewerIds: string[];
  /** Display name from the first tracker that knows it. */
  name: string | null;
  isLoading: boolean;
  isError: boolean;
};

type TaggedViewer = (Me & { tracker: TrackerId }) | null;

function combineViewer(results: UseQueryResult<TaggedViewer>[]): Viewer {
  const ids: Partial<Record<TrackerId, string>> = {};
  let name: string | null = null;
  for (const r of results) {
    if (!r.data) continue;
    ids[r.data.tracker] = r.data.viewerId;
    if (!name && r.data.viewerName) name = r.data.viewerName;
  }
  return {
    ids,
    viewerIds: Object.values(ids),
    name,
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
  };
}

/** Who "me" is in every active tracker. */
export function useViewer(): Viewer {
  const trackers = useActiveTrackers();
  return useQueries({
    queries: trackers.map((t) => ({
      queryKey: TRACKER_ADAPTERS[t].viewerKey,
      queryFn: TRACKER_ADAPTERS[t].getViewer,
      staleTime: Infinity,
      select: (me: Me | null): TaggedViewer => (me ? { ...me, tracker: t } : null),
    })),
    combine: combineViewer,
  });
}

const WAITING: Merged<never> = { data: undefined, isLoading: true, isError: false };

/** One query per active tracker over `fetch`, with `ME` resolved per tracker. */
function useTrackerList<T>(
  root: string,
  filters: TaskFilters,
  extraKey: unknown[],
  fetch: (tracker: TrackerId, filters: TaskFilters) => Promise<T[]>,
): Merged<T> {
  const trackers = useActiveTrackers();
  const viewer = useViewer();
  const waiting = filters.assigneeId === ME && viewer.isLoading;
  const queries = waiting
    ? []
    : trackers.flatMap((t) => {
        const f = resolveFilters(t, filters, viewer.ids);
        return f ? [{ queryKey: [root, t, ...extraKey, f] as QueryKey, queryFn: () => fetch(t, f) }] : [];
      });
  const merged = useQueries({ queries, combine: mergeResults<T> });
  return waiting ? WAITING : merged;
}

export function useTasks(filters: TaskFilters = {}): Merged<Task> {
  return useTrackerList("issues", filters, [], (t, f) => TRACKER_ADAPTERS[t].listTasks(f));
}

export function useCalendarTasks(range: { start: string; end: string }, filters: TaskFilters): Merged<TaskSummary> {
  return useTrackerList("calendar", filters, [range.start, range.end], (t, f) =>
    TRACKER_ADAPTERS[t].listCalendar({ ...range, ...f }),
  );
}

export function useUnscheduledTasks(filters: TaskFilters): Merged<TaskSummary> {
  return useTrackerList("unscheduled", filters, [], (t, f) => TRACKER_ADAPTERS[t].listUnscheduled(f));
}

/** One unfiltered list per active tracker (relations, statuses, users). */
function useTrackerSimple<T>(root: string, fetch: (tracker: TrackerId) => Promise<T[]>, staleTime = 0): Merged<T> {
  const trackers = useActiveTrackers();
  return useQueries({
    queries: trackers.map((t) => ({ queryKey: [root, t] as QueryKey, queryFn: () => fetch(t), staleTime })),
    combine: mergeResults<T>,
  });
}

export function useTaskRelations(): Merged<TaskRelation> {
  return useTrackerSimple("relations", (t) => TRACKER_ADAPTERS[t].listRelations());
}

export function useTaskStatuses(): Merged<TaskStatus> {
  return useTrackerSimple("workflow-states", (t) => TRACKER_ADAPTERS[t].listStatuses(), 5 * 60_000);
}

export function useTaskUsers(): Merged<User> {
  return useTrackerSimple("users", (t) => TRACKER_ADAPTERS[t].listUsers(), 5 * 60_000);
}

function combineFilterOptions(results: UseQueryResult<FilterOptions>[]): { data: FilterOptions | undefined } {
  if (!results.some((r) => r.data)) return { data: undefined };
  return {
    data: {
      teams: results.flatMap((r) => r.data?.teams ?? []),
      projects: results.flatMap((r) => r.data?.projects ?? []),
    },
  };
}

/** Teams (workflow scopes) and projects across every active tracker. */
export function useTaskFilterOptions(): { data: FilterOptions | undefined } {
  const trackers = useActiveTrackers();
  return useQueries({
    queries: trackers.map((t) => ({
      queryKey: ["filter-options", t] as QueryKey,
      queryFn: () => TRACKER_ADAPTERS[t].listFilterOptions(),
    })),
    combine: combineFilterOptions,
  });
}

// ── Routed mutations ─────────────────────────────────────────────────────────

type StateInfo = { stateName: string | null; stateType: string; stateColor: string };

/** Lookups that re-derive the denormalized fields a patch changes (names, colors). */
type ListLookups = {
  stateById: Map<string, StateInfo>;
  nameById: Map<string, string | null>;
  labelById: Map<string, Task["labels"][number]>;
  projectNameById: Map<string, string | null>;
};

/**
 * Apply a patch to a cached list item, re-deriving the denormalized fields the
 * board groups on (assignee name, status name/type/color) from lookup maps built
 * out of the other cached tasks. Best-effort: unknown targets leave fields as-is.
 */
function applyPatchToListItem(it: Task, patch: TaskPatch, lk: ListLookups): Task {
  const next: Task = { ...it };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.dueDate !== undefined) next.dueDate = patch.dueDate;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.estimate !== undefined) next.estimate = patch.estimate;
  if (patch.assigneeId !== undefined) {
    next.assigneeId = patch.assigneeId;
    next.assigneeName = patch.assigneeId ? lk.nameById.get(patch.assigneeId) ?? null : null;
  }
  if (patch.stateId !== undefined) {
    next.stateId = patch.stateId;
    const st = patch.stateId ? lk.stateById.get(patch.stateId) : undefined;
    if (st) {
      next.stateName = st.stateName;
      next.stateType = st.stateType;
      next.stateColor = st.stateColor;
    }
  }
  if (patch.projectId !== undefined) {
    next.projectId = patch.projectId;
    next.projectName = patch.projectId ? lk.projectNameById.get(patch.projectId) ?? null : null;
  }
  if (patch.labelIds !== undefined) {
    // Resolve known labels; ids not yet seen in the cache fill in on refetch.
    next.labels = patch.labelIds.map((id) => lk.labelById.get(id)).filter((l): l is Task["labels"][number] => !!l);
  }
  if (patch.teamId !== undefined) {
    // Team key + the now-invalid team-scoped state reconcile on the settle refetch.
    next.teamId = patch.teamId;
  }
  // Local-only fields ride along for rows that have them (local tasks).
  const local = next as Task & { startDate?: string | null; position?: number };
  if (patch.startDate !== undefined && "startDate" in local) local.startDate = patch.startDate;
  if (patch.position !== undefined && "position" in local) local.position = patch.position;
  return next;
}

// Snapshot of every cache entry we touch, for rollback.
type Snapshot = [QueryKey, unknown][];

/** Cache entries under `root` that belong to `tracker` (key `[root, tracker, …]`). */
function entriesOf<T>(qc: ReturnType<typeof useQueryClient>, root: string, tracker: TrackerId): [QueryKey, T | undefined][] {
  return qc.getQueriesData<T>({ queryKey: [root, tracker] });
}

type UpdateVars = { id: string; patch: TaskPatch; silent?: boolean };

/** Update a task in its own tracker, optimistically moving it in that tracker's caches. */
export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateVars) => TRACKER_ADAPTERS[trackerOf(id)].update(id, patch),
    onMutate: async ({ id, patch }) => {
      const tracker = trackerOf(id);
      await qc.cancelQueries({ queryKey: ["calendar"] });
      await qc.cancelQueries({ queryKey: ["unscheduled"] });
      await qc.cancelQueries({ queryKey: ["issues"] });
      const detailKey = TRACKER_ADAPTERS[tracker].detailKey(id);
      await qc.cancelQueries({ queryKey: detailKey });

      // Only this tracker's entries: a task never belongs to another tracker's cache.
      const calEntries = entriesOf<TaskSummary[]>(qc, "calendar", tracker);
      const unschedEntries = entriesOf<TaskSummary[]>(qc, "unscheduled", tracker);
      const issuesEntries = entriesOf<Task[]>(qc, "issues", tracker);
      const snapshot: Snapshot = [
        ...calEntries,
        ...unschedEntries,
        ...issuesEntries,
        [detailKey, qc.getQueryData(detailKey)],
      ];

      // Optimistically move the task within the list/board caches so a board
      // drag lands immediately (and rolls back on error) instead of snapping back.
      const allListed = issuesEntries.flatMap(([, l]) => l ?? []);
      const lookups: ListLookups = {
        stateById: new Map(),
        nameById: new Map(),
        labelById: new Map(),
        projectNameById: new Map(),
      };
      for (const it of allListed) {
        if (it.stateId) {
          lookups.stateById.set(it.stateId, {
            stateName: it.stateName,
            stateType: it.stateType,
            stateColor: it.stateColor,
          });
        }
        if (it.assigneeId) lookups.nameById.set(it.assigneeId, it.assigneeName);
        if (it.projectId) lookups.projectNameById.set(it.projectId, it.projectName);
        for (const l of it.labels) lookups.labelById.set(l.id, l);
      }
      const currentList = allListed.find((item) => item.id === id);
      if (currentList) {
        const updatedList = applyPatchToListItem(currentList, patch, lookups);
        for (const [key, list] of issuesEntries) {
          const filters = (key[2] ?? {}) as TaskFilters;
          qc.setQueryData(key, reconcileList(list ?? [], updatedList, matchesFilters(updatedList, filters)));
        }
      }

      // Find the task's current summary from any cache, then compute its patched form.
      const current =
        calEntries.flatMap(([, l]) => l ?? []).find((i) => i.id === id) ??
        unschedEntries.flatMap(([, l]) => l ?? []).find((i) => i.id === id) ??
        (currentList ? calendarIssueFromList(currentList) : undefined);

      if (current) {
        const updated = applyPatchToCalendarIssue(current, patch);
        // Each calendar cache reconciles against ITS OWN range + filters.
        for (const [key, list] of calEntries) {
          const start = key[2] as string;
          const end = key[3] as string;
          const filters = (key[4] ?? {}) as TaskFilters;
          const belongs = inRange(updated.dueDate, start, end) && matchesFilters(updated, filters);
          qc.setQueryData(key, reconcileList(list ?? [], updated, belongs));
        }
        // Each unscheduled cache reconciles against its filters (belongs iff dueDate === null).
        for (const [key, list] of unschedEntries) {
          const filters = (key[2] ?? {}) as TaskFilters;
          const belongs = updated.dueDate === null && matchesFilters(updated, filters);
          qc.setQueryData(key, reconcileList(list ?? [], updated, belongs));
        }
      }

      // Patch the open drawer's detail cache so it reflects the edit.
      const detail = qc.getQueryData(detailKey);
      if (detail) qc.setQueryData(detailKey, TRACKER_ADAPTERS[tracker].patchDetail(detail, patch));

      return { snapshot };
    },
    onError: (err, vars, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      if (!vars.silent) gooeyToast.error("Update failed", { description: errorText(err) });
    },
    onSettled: (_data, _err, { id }) => {
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["unscheduled"] });
      qc.invalidateQueries({ queryKey: ["issues"] });
      qc.invalidateQueries({ queryKey: TRACKER_ADAPTERS[trackerOf(id)].detailKey(id) });
      qc.invalidateQueries({ queryKey: ["filter-options"] });
    },
  });
}

/** Delete a task in its own tracker, then drop it from the renderer caches. */
export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => TRACKER_ADAPTERS[trackerOf(id)].remove(id),
    onMutate: async (id) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ["calendar"] }),
        qc.cancelQueries({ queryKey: ["unscheduled"] }),
        qc.cancelQueries({ queryKey: ["issues"] }),
        qc.cancelQueries({ queryKey: TRACKER_ADAPTERS[trackerOf(id)].detailKey(id) }),
      ]);
      const entries = ["calendar", "unscheduled", "issues"].flatMap((root) =>
        qc.getQueriesData<{ id: string }[]>({ queryKey: [root] }),
      );
      const detailKey = TRACKER_ADAPTERS[trackerOf(id)].detailKey(id);
      const snapshot: Snapshot = [...entries, [detailKey, qc.getQueryData(detailKey)]];
      for (const [key, list] of entries) {
        if (list) qc.setQueryData(key, list.filter((task) => task.id !== id));
      }
      return { snapshot };
    },
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: TRACKER_ADAPTERS[trackerOf(id)].detailKey(id) });
      qc.invalidateQueries({ queryKey: ["filter-options"] });
      gooeyToast.success(trackerOf(id) === "linear" ? "Issue deleted" : "Task deleted");
    },
    onError: (err, _id, context) => {
      context?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      gooeyToast.error("Delete failed", { description: errorText(err) });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["unscheduled"] });
      qc.invalidateQueries({ queryKey: ["issues"] });
    },
  });
}

/** Create a relation between two tasks of the same tracker, then refresh relations. */
export function useCreateTaskRelation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ issueId, relatedIssueId, type }: { issueId: string; relatedIssueId: string; type: RelationType }) => {
      const tracker = trackerOf(issueId);
      if (trackerOf(relatedIssueId) !== tracker) {
        return Promise.reject("Tasks from different trackers can't be related.");
      }
      return TRACKER_ADAPTERS[tracker].createRelation(issueId, relatedIssueId, type);
    },
    onSuccess: (_data, { issueId, relatedIssueId }) => {
      qc.invalidateQueries({ queryKey: ["relations"] });
      // The drawer/full-page detail reads relations live, so refresh both ends.
      qc.invalidateQueries({ queryKey: TRACKER_ADAPTERS[trackerOf(issueId)].detailKey(issueId) });
      qc.invalidateQueries({ queryKey: TRACKER_ADAPTERS[trackerOf(relatedIssueId)].detailKey(relatedIssueId) });
      gooeyToast.success("Relation added");
    },
    onError: (err) => gooeyToast.error("Couldn't add relation", { description: errorText(err) }),
  });
}
