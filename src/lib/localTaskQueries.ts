/**
 * Local-tasks queries and mutations (the `local-tasks` module). Task rows share
 * the tracker cache (`["issues", "local-tasks", filters]`, see taskQueries.ts),
 * so the Tasks screen and the merged screens stay in step. Writes are local
 * SQLite calls: they refetch on success and toast on failure.
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import {
  addLocalAttachment,
  addLocalChecklistItem,
  addLocalComment,
  createLocalLabel,
  createLocalList,
  createLocalRelation,
  createLocalSpace,
  createLocalSprint,
  createLocalTask,
  deleteLocalAttachment,
  deleteLocalChecklistItem,
  deleteLocalComment,
  deleteLocalList,
  deleteLocalRelation,
  deleteLocalSpace,
  deleteLocalSprint,
  ensureLocalTasksBackup,
  errorText,
  getLocalTaskDetail,
  listLocalTasks,
  listLocalTree,
  renameLocalSpace,
  setLocalStatuses,
  updateLocalChecklistItem,
  updateLocalComment,
  updateLocalList,
  updateLocalSprint,
  type CreateLocalTaskInput,
  type IssueFilters,
  type LocalStatusInput,
  type LocalTask,
} from "./commands";
import { useModules } from "./modules";
import { dhakaToday } from "./dates";

export const LOCAL_TREE_KEY = ["local-tasks", "tree"] as const;
export const localDetailKey = (id: string) => ["local-task", id] as const;

function useLocalOn(): boolean {
  return useModules().isActive("local-tasks");
}

/** Spaces, lists, workflows, sprints and labels (seeded on first use). */
export function useLocalTree() {
  const on = useLocalOn();
  return useQuery({ queryKey: LOCAL_TREE_KEY, queryFn: listLocalTree, enabled: on });
}

/** Local task rows, cached under the tracker key so merged screens share them. */
export function useLocalTasks(filters: IssueFilters) {
  const on = useLocalOn();
  return useQuery({
    queryKey: ["issues", "local-tasks", filters],
    queryFn: () => listLocalTasks(filters),
    enabled: on,
  });
}

export function useLocalTaskDetail(id: string | null) {
  const on = useLocalOn();
  return useQuery({
    queryKey: localDetailKey(id ?? ""),
    queryFn: () => getLocalTaskDetail(id as string),
    enabled: on && !!id,
  });
}

/** Refetch every local-task read after a write (tasks, merged views, tree, details). */
export function invalidateLocal(qc: QueryClient, opts: { tree?: boolean } = {}) {
  for (const root of ["issues", "calendar", "unscheduled", "relations", "filter-options", "workflow-states"]) {
    void qc.invalidateQueries({ queryKey: [root, "local-tasks"] });
  }
  void qc.invalidateQueries({ queryKey: ["local-task"] });
  if (opts.tree) void qc.invalidateQueries({ queryKey: LOCAL_TREE_KEY });
}

/** A local write that refetches local reads on success and names its failure in a toast. */
function useLocalWrite<V, R>(fn: (vars: V) => Promise<R>, failure: string, opts: { tree?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => invalidateLocal(qc, opts),
    onError: (err) => gooeyToast.error(failure, { description: errorText(err) }),
  });
}

export function useCreateLocalTask() {
  return useLocalWrite((input: CreateLocalTaskInput): Promise<LocalTask> => createLocalTask(input), "Couldn't create task");
}

export function useCreateLocalSpace() {
  return useLocalWrite((name: string) => createLocalSpace(name), "Couldn't create space", { tree: true });
}

export function useRenameLocalSpace() {
  return useLocalWrite(({ id, name }: { id: string; name: string }) => renameLocalSpace(id, name), "Couldn't rename space", { tree: true });
}

export function useDeleteLocalSpace() {
  return useLocalWrite((id: string) => deleteLocalSpace(id), "Couldn't delete space", { tree: true });
}

export function useCreateLocalList() {
  return useLocalWrite(
    ({ spaceId, name, key }: { spaceId: string; name: string; key: string }) => createLocalList(spaceId, name, key),
    "Couldn't create list",
    { tree: true },
  );
}

export function useUpdateLocalList() {
  return useLocalWrite(
    ({ id, name, key }: { id: string; name?: string; key?: string }) => updateLocalList(id, name, key),
    "Couldn't update list",
    { tree: true },
  );
}

export function useDeleteLocalList() {
  return useLocalWrite((id: string) => deleteLocalList(id), "Couldn't delete list", { tree: true });
}

export function useSetLocalStatuses() {
  return useLocalWrite(
    ({ scopeId, statuses }: { scopeId: string; statuses: LocalStatusInput[] }) => setLocalStatuses(scopeId, statuses),
    "Couldn't save the workflow",
    { tree: true },
  );
}

type SprintVars = { name: string; startDate: string | null; endDate: string | null };

export function useCreateLocalSprint() {
  return useLocalWrite(
    ({ spaceId, name, startDate, endDate }: SprintVars & { spaceId: string }) =>
      createLocalSprint(spaceId, name, startDate, endDate),
    "Couldn't create sprint",
    { tree: true },
  );
}

export function useUpdateLocalSprint() {
  return useLocalWrite(
    ({ id, name, startDate, endDate }: SprintVars & { id: string }) => updateLocalSprint(id, name, startDate, endDate),
    "Couldn't update sprint",
    { tree: true },
  );
}

export function useDeleteLocalSprint() {
  return useLocalWrite((id: string) => deleteLocalSprint(id), "Couldn't delete sprint", { tree: true });
}

export function useCreateLocalLabel() {
  return useLocalWrite(
    ({ name, color }: { name: string; color: string }) => createLocalLabel(name, color),
    "Couldn't create label",
    { tree: true },
  );
}

export function useAddChecklistItem() {
  return useLocalWrite(({ taskId, body }: { taskId: string; body: string }) => addLocalChecklistItem(taskId, body), "Couldn't add the item");
}

export function useUpdateChecklistItem() {
  return useLocalWrite(
    ({ id, body, done }: { id: string; body?: string; done?: boolean }) => updateLocalChecklistItem(id, { body, done }),
    "Couldn't update the item",
  );
}

export function useDeleteChecklistItem() {
  return useLocalWrite((id: string) => deleteLocalChecklistItem(id), "Couldn't delete the item");
}

export function useAddLocalComment() {
  return useLocalWrite(({ taskId, body }: { taskId: string; body: string }) => addLocalComment(taskId, body), "Couldn't post comment");
}

export function useUpdateLocalComment() {
  return useLocalWrite(({ id, body }: { id: string; body: string }) => updateLocalComment(id, body), "Couldn't update comment");
}

export function useDeleteLocalComment() {
  return useLocalWrite((id: string) => deleteLocalComment(id), "Couldn't delete comment");
}

export function useAddLocalAttachment() {
  return useLocalWrite(
    ({ taskId, url, title }: { taskId: string; url: string; title?: string | null }) => addLocalAttachment(taskId, url, title),
    "Couldn't add link",
  );
}

export function useDeleteLocalAttachment() {
  return useLocalWrite((id: string) => deleteLocalAttachment(id), "Couldn't remove link");
}

export function useCreateLocalRelation() {
  return useLocalWrite(
    ({ taskId, relatedId, kind }: { taskId: string; relatedId: string; kind: "blocks" | "related" }) =>
      createLocalRelation(taskId, relatedId, kind),
    "Couldn't link tasks",
  );
}

export function useDeleteLocalRelation() {
  return useLocalWrite(
    ({ taskId, relatedId, kind }: { taskId: string; relatedId: string; kind: string }) =>
      deleteLocalRelation(taskId, relatedId, kind),
    "Couldn't remove the link",
  );
}

export const LOCAL_BACKUP_KEY = ["local-tasks", "backup"] as const;

/**
 * Today's automatic backup (once per Dhaka day) plus the backups folder. Runs
 * while the module is on; a failure is shown once, since the user relies on it.
 */
export function useLocalBackup({ notify = false }: { notify?: boolean } = {}) {
  const on = useLocalOn();
  const today = dhakaToday();
  const query = useQuery({
    queryKey: [...LOCAL_BACKUP_KEY, today],
    queryFn: () => ensureLocalTasksBackup(today),
    enabled: on,
    staleTime: Infinity,
    retry: false,
  });
  useEffect(() => {
    if (notify && query.isError) gooeyToast.error("Couldn't write today's local-tasks backup", { description: errorText(query.error) });
  }, [notify, query.isError, query.error]);
  return query;
}
