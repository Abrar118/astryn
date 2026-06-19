import { useEffect } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import {
  createIssue,
  deleteIssue,
  errorText,
  getIssueDetail,
  getMe,
  listCalendarIssues,
  listCycles,
  listFilterOptions,
  listIssues,
  listLabels,
  listUnscheduled,
  listUsers,
  syncIssues,
  updateIssue,
  type CalendarIssue,
  type CreateIssueInput,
  type IssueDetailResult,
  type IssueFilters,
  type IssueListItem,
  type Label,
  type LiveDetail,
  type UpdateIssuePatch,
} from "./commands";
import {
  applyPatchToCalendarIssue,
  inRange,
  matchesFilters,
  reconcileList,
} from "./optimistic";

/** Merge a patch's changed fields into a cached detail result (any branch). */
function patchDetail(result: IssueDetailResult, patch: UpdateIssuePatch): IssueDetailResult {
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

type StateInfo = { stateName: string | null; stateType: string; stateColor: string };

/**
 * Apply a patch to a cached list item, re-deriving the denormalized fields the
 * board groups on (assignee name, status name/type/color) from lookup maps built
 * out of the other cached issues. Best-effort: unknown targets leave fields as-is.
 */
type ListLookups = {
  stateById: Map<string, StateInfo>;
  nameById: Map<string, string | null>;
  labelById: Map<string, Label>;
  projectNameById: Map<string, string | null>;
};

function applyPatchToListItem(it: IssueListItem, patch: UpdateIssuePatch, lk: ListLookups): IssueListItem {
  const next: IssueListItem = { ...it };
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
    next.labels = patch.labelIds.map((id) => lk.labelById.get(id)).filter((l): l is Label => !!l);
  }
  return next;
}

/**
 * Drop every workspace-scoped query so the renderer cannot keep showing the old
 * workspace's data after the Rust cache is wiped (key set/clear). Call this on
 * BOTH success and failure of set/clear — the Rust wipe happens before the
 * keyring write, so a failed write still leaves an empty cache.
 */
const WORKSPACE_KEYS = [
  ["calendar"], ["unscheduled"], ["issues"], ["issue"], ["users"], ["labels"], ["cycles"],
  ["filter-options"], ["me"],
];

export function clearWorkspaceQueries(qc: QueryClient) {
  for (const key of WORKSPACE_KEYS) {
    qc.cancelQueries({ queryKey: key });
    qc.removeQueries({ queryKey: key });
  }
}

/**
 * Refetch every workspace-scoped query in place. Use after a Resync (the Rust
 * cache was wiped + rebuilt) so removed issues disappear and the renderer
 * reflects the rebuilt cache — without the empty flash that removeQueries causes.
 */
export function invalidateWorkspaceQueries(qc: QueryClient) {
  for (const key of WORKSPACE_KEYS) qc.invalidateQueries({ queryKey: key });
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: getMe, staleTime: Infinity });
}

export function useFilterOptions() {
  return useQuery({ queryKey: ["filter-options"], queryFn: listFilterOptions });
}

export function useUsers() {
  return useQuery({ queryKey: ["users"], queryFn: listUsers, staleTime: 5 * 60_000 });
}

export function useLabels() {
  return useQuery({ queryKey: ["labels"], queryFn: listLabels, staleTime: 5 * 60_000 });
}

export function useCycles() {
  return useQuery({ queryKey: ["cycles"], queryFn: listCycles, staleTime: 5 * 60_000 });
}

/** Delete (trash) an issue in Linear, then drop it from the renderer caches. */
export function useDeleteIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteIssue(id),
    onSuccess: (_data, id) => {
      for (const key of [["calendar"], ["unscheduled"], ["issues"]]) {
        for (const [k, list] of qc.getQueriesData<{ id: string }[]>({ queryKey: key })) {
          if (list) qc.setQueryData(k, list.filter((i) => i.id !== id));
        }
      }
      qc.removeQueries({ queryKey: ["issue", id] });
      qc.invalidateQueries({ queryKey: ["filter-options"] });
      gooeyToast.success("Issue deleted");
    },
    onError: (err) => gooeyToast.error("Delete failed", { description: errorText(err) }),
  });
}

/** Create an issue in Linear, then refresh the workspace caches so it appears. */
export function useCreateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateIssueInput) => createIssue(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["unscheduled"] });
      qc.invalidateQueries({ queryKey: ["issues"] });
      qc.invalidateQueries({ queryKey: ["filter-options"] });
      gooeyToast.success("Issue created");
    },
    onError: (err) => gooeyToast.error("Create failed", { description: errorText(err) }),
  });
}

export function useCalendarIssues(range: { start: string; end: string }, filters: IssueFilters) {
  return useQuery({
    queryKey: ["calendar", range.start, range.end, filters],
    queryFn: () => listCalendarIssues({ ...range, ...filters }),
  });
}

export function useUnscheduled(filters: IssueFilters) {
  return useQuery({
    queryKey: ["unscheduled", filters],
    queryFn: () => listUnscheduled(filters),
  });
}

export function useIssues(filters: IssueFilters) {
  return useQuery({
    queryKey: ["issues", filters],
    queryFn: () => listIssues(filters),
  });
}

export function useIssueDetail(id: string | null, seed?: CalendarIssue) {
  return useQuery({
    queryKey: ["issue", id],
    queryFn: () => getIssueDetail(id as string),
    enabled: !!id,
    placeholderData: seed ? ({ source: "preview", detail: seed } as IssueDetailResult) : undefined,
  });
}

type UpdateVars = { id: string; patch: UpdateIssuePatch };

// Snapshot of every calendar/unscheduled cache entry we touch, for rollback.
type Snapshot = [QueryKey, unknown][];

export function useUpdateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateVars) => updateIssue(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["calendar"] });
      await qc.cancelQueries({ queryKey: ["unscheduled"] });
      await qc.cancelQueries({ queryKey: ["issues"] });
      await qc.cancelQueries({ queryKey: ["issue", id] });

      const calEntries = qc.getQueriesData<CalendarIssue[]>({ queryKey: ["calendar"] });
      const unschedEntries = qc.getQueriesData<CalendarIssue[]>({ queryKey: ["unscheduled"] });
      const issuesEntries = qc.getQueriesData<IssueListItem[]>({ queryKey: ["issues"] });
      const snapshot: Snapshot = [
        ...calEntries,
        ...unschedEntries,
        ...issuesEntries,
        [["issue", id], qc.getQueryData(["issue", id])],
      ];

      // Optimistically move the issue within the list/board caches so a board
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
      for (const [key, list] of issuesEntries) {
        if (!list) continue;
        qc.setQueryData(
          key,
          list.map((it) => (it.id === id ? applyPatchToListItem(it, patch, lookups) : it)),
        );
      }

      // Find the issue's current CalendarIssue from any cache, then compute its patched form.
      const current =
        calEntries.flatMap(([, l]) => l ?? []).find((i) => i.id === id) ??
        unschedEntries.flatMap(([, l]) => l ?? []).find((i) => i.id === id);

      if (current) {
        const updated = applyPatchToCalendarIssue(current, patch);
        // Each calendar cache reconciles against ITS OWN range + filters.
        for (const [key, list] of calEntries) {
          const start = key[1] as string;
          const end = key[2] as string;
          const filters = (key[3] ?? {}) as IssueFilters;
          const belongs = inRange(updated.dueDate, start, end) && matchesFilters(updated, filters);
          qc.setQueryData(key, reconcileList(list ?? [], updated, belongs));
        }
        // Each unscheduled cache reconciles against its filters (belongs iff dueDate === null).
        for (const [key, list] of unschedEntries) {
          const filters = (key[1] ?? {}) as IssueFilters;
          const belongs = updated.dueDate === null && matchesFilters(updated, filters);
          qc.setQueryData(key, reconcileList(list ?? [], updated, belongs));
        }
      }

      // Patch the drawer detail cache (any branch) so the open drawer reflects the edit.
      const detail = qc.getQueryData<IssueDetailResult>(["issue", id]);
      if (detail) qc.setQueryData(["issue", id], patchDetail(detail, patch));

      return { snapshot };
    },
    onError: (err, _vars, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      gooeyToast.error("Update failed", { description: errorText(err) });
    },
    onSettled: (_data, _err, { id }) => {
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["unscheduled"] });
      qc.invalidateQueries({ queryKey: ["issues"] });
      qc.invalidateQueries({ queryKey: ["issue", id] });
      qc.invalidateQueries({ queryKey: ["filter-options"] });
    },
  });
}

/** Runs sync on mount + every 5 minutes; exposes a manual refresh + status. */
export function useSyncLoop() {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => syncIssues(false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["unscheduled"] });
      qc.invalidateQueries({ queryKey: ["issues"] });
      qc.invalidateQueries({ queryKey: ["filter-options"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => gooeyToast.error("Sync failed", { description: errorText(err) }),
  });
  // Stable refs: trigger once on mount, then on an interval.
  useEffect(() => {
    mut.mutate();
    const t = setInterval(() => mut.mutate(), 5 * 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { isSyncing: mut.isPending, refresh: () => mut.mutate() };
}
