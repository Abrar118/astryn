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
  errorText,
  getIssueDetail,
  getMe,
  listCalendarIssues,
  listFilterOptions,
  listIssues,
  listUnscheduled,
  listUsers,
  syncIssues,
  updateIssue,
  type CalendarIssue,
  type IssueDetailResult,
  type IssueFilters,
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

/**
 * Drop every workspace-scoped query so the renderer cannot keep showing the old
 * workspace's data after the Rust cache is wiped (key set/clear). Call this on
 * BOTH success and failure of set/clear — the Rust wipe happens before the
 * keyring write, so a failed write still leaves an empty cache.
 */
export function clearWorkspaceQueries(qc: QueryClient) {
  for (const key of [
    ["calendar"], ["unscheduled"], ["issues"], ["issue"], ["users"], ["filter-options"], ["me"],
  ]) {
    qc.cancelQueries({ queryKey: key });
    qc.removeQueries({ queryKey: key });
  }
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
      await qc.cancelQueries({ queryKey: ["issue", id] });

      const calEntries = qc.getQueriesData<CalendarIssue[]>({ queryKey: ["calendar"] });
      const unschedEntries = qc.getQueriesData<CalendarIssue[]>({ queryKey: ["unscheduled"] });
      const snapshot: Snapshot = [
        ...calEntries,
        ...unschedEntries,
        [["issue", id], qc.getQueryData(["issue", id])],
      ];

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
