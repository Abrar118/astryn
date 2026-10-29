/**
 * F9 per-task doc links: server state for the drawer's "Docs & links" section.
 * Links are app-owned rows owned by the Docs module, keyed by the task's
 * tracker and id, so they work the same for every tracker.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import {
  createDocLink,
  deleteDocLink,
  errorText,
  listDocLinks,
  updateDocLink,
  type DocLink,
  type DocLinkInput,
} from "./commands";
import { useModules } from "./modules";
import { isModuleOff } from "./queries";
import type { TrackerId } from "./tracker";

export const docLinksKey = (tracker: TrackerId, taskId: string) => ["doc-links", tracker, taskId] as const;

export function useDocLinks(tracker: TrackerId, taskId: string) {
  const on = useModules().isActive("docs");
  return useQuery({
    queryKey: docLinksKey(tracker, taskId),
    queryFn: () => listDocLinks(tracker, taskId),
    enabled: on,
  });
}

/** The fields an input sets, as the row will look once saved (Rust re-normalizes). */
function applyInput(input: DocLinkInput): Pick<DocLink, "kind" | "url" | "sourceId" | "docPath" | "title" | "note" | "tags"> {
  const doc = input.kind === "doc";
  return {
    kind: input.kind,
    url: doc ? null : (input.url?.trim() ?? null),
    sourceId: doc ? (input.sourceId ?? null) : null,
    docPath: doc ? (input.docPath ?? null) : null,
    title: input.title?.trim() || null,
    note: input.note?.trim() || null,
    tags: input.tags,
  };
}

type Snapshot = { prev: DocLink[] | undefined };

/** Optimistically edit one task's cached list; returns what to roll back to. */
async function edit(qc: QueryClient, key: readonly unknown[], change: (links: DocLink[]) => DocLink[]): Promise<Snapshot> {
  await qc.cancelQueries({ queryKey: key });
  const prev = qc.getQueryData<DocLink[]>(key);
  if (prev) qc.setQueryData(key, change(prev));
  return { prev };
}

function rollback(qc: QueryClient, key: readonly unknown[], ctx: Snapshot | undefined, err: unknown, title: string) {
  if (ctx?.prev) qc.setQueryData(key, ctx.prev);
  if (!isModuleOff(err)) gooeyToast.error(title, { description: errorText(err) });
}

export function useCreateDocLink(tracker: TrackerId, taskId: string) {
  const qc = useQueryClient();
  const key = docLinksKey(tracker, taskId);
  return useMutation({
    mutationFn: (input: DocLinkInput) => createDocLink(tracker, taskId, input),
    onMutate: async (input) => {
      const tempId = `pending-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const pending: DocLink = { id: tempId, tracker, taskId, ...applyInput(input), createdAt: now, updatedAt: now };
      return { ...(await edit(qc, key, (links) => [...links, pending])), tempId };
    },
    onError: (err, _input, ctx) => rollback(qc, key, ctx, err, "Couldn't add link"),
    onSuccess: (saved, _input, ctx) =>
      qc.setQueryData<DocLink[]>(key, (cur) => cur?.map((l) => (l.id === ctx?.tempId ? saved : l))),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useUpdateDocLink(tracker: TrackerId, taskId: string) {
  const qc = useQueryClient();
  const key = docLinksKey(tracker, taskId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: DocLinkInput }) => updateDocLink(id, input),
    onMutate: ({ id, input }) => edit(qc, key, (links) => links.map((l) => (l.id === id ? { ...l, ...applyInput(input) } : l))),
    onError: (err, _vars, ctx) => rollback(qc, key, ctx, err, "Couldn't save link"),
    onSuccess: (saved) => qc.setQueryData<DocLink[]>(key, (cur) => cur?.map((l) => (l.id === saved.id ? saved : l))),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useDeleteDocLink(tracker: TrackerId, taskId: string) {
  const qc = useQueryClient();
  const key = docLinksKey(tracker, taskId);
  return useMutation({
    mutationFn: (id: string) => deleteDocLink(id),
    onMutate: (id) => edit(qc, key, (links) => links.filter((l) => l.id !== id)),
    onError: (err, _id, ctx) => rollback(qc, key, ctx, err, "Couldn't remove link"),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}
