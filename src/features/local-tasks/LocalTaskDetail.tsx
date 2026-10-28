import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { gooeyToast } from "goey-toast";
import { Check, ExternalLink, Link2, Maximize2, Plus, Tag, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/DatePicker";
import { Popover, PopoverItem } from "@/components/Popover";
import { StatusIcon } from "@/features/drawer/issueGlyphs";
import { DescriptionEditor, ReadOnlyDescription } from "@/features/drawer/DescriptionEditor";
import { timeAgo } from "@/features/drawer/timeAgo";
import {
  useAddChecklistItem,
  useAddLocalAttachment,
  useAddLocalComment,
  useCreateLocalLabel,
  useCreateLocalRelation,
  useDeleteChecklistItem,
  useDeleteLocalAttachment,
  useDeleteLocalComment,
  useDeleteLocalRelation,
  useLocalTaskDetail,
  useLocalTasks,
  useLocalTree,
  useUpdateChecklistItem,
  useUpdateLocalComment,
} from "@/lib/localTaskQueries";
import { useDeleteTask, useUpdateTask } from "@/lib/taskQueries";
import type { LocalTaskDetail as Detail, LocalComment } from "@/lib/commands";
import type { TaskPatch } from "@/lib/tracker";
import { safeExternalUrl } from "@/lib/links";
import { useWorkspace } from "@/lib/tabs";
import { cn } from "@/lib/utils";
import { STATUS_COLORS } from "./WorkflowDialog";
import { AssigneeToggle, PrioritySelect, SprintSelect, StatusSelect } from "./LocalFields";
import { QuickAdd } from "./QuickAdd";

const RELATION_LABEL: Record<string, string> = { blocks: "Blocking", blocked_by: "Blocked by", related: "Related" };

function openExternal(href: string) {
  const url = safeExternalUrl(href);
  if (url) openUrl(url).catch(() => gooeyToast.error("Couldn't open the link"));
  else gooeyToast.error("Blocked unsafe link");
}

function Section({ title, count, children, action }: { title: string; count?: number; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-t border-border/60 px-6 py-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h3>
        {count !== undefined && count > 0 && <span className="text-xs tabular-nums text-muted-foreground">{count}</span>}
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <span className="w-20 shrink-0 text-[13px] text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function LabelsField({ d, onChange }: { d: Detail; onChange: (ids: string[]) => void }) {
  const { data: tree } = useLocalTree();
  const createLabel = useCreateLocalLabel();
  const [query, setQuery] = useState("");
  const applied = new Set(d.labels.map((l) => l.id));
  const all = tree?.labels ?? [];
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((l) => l.name.toLowerCase().includes(q)) : all;
  const toggle = (id: string) => onChange(applied.has(id) ? [...applied].filter((x) => x !== id) : [...applied, id]);
  return (
    <Popover
      buttonTitle="Labels"
      buttonClassName="flex min-w-0 cursor-pointer flex-wrap items-center gap-1 rounded-md px-1.5 py-1 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      panelClassName="w-64 rounded-md border border-border bg-popover p-1 shadow-2xl"
      button={
        d.labels.length === 0 ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Tag className="size-3.5" /> Add labels
          </span>
        ) : (
          d.labels.map((l) => (
            <span key={l.id} className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-foreground">
              <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: l.color ?? undefined }} />
              {l.name}
            </span>
          ))
        )
      }
    >
      {() => (
        <>
          <input
            autoFocus
            aria-label="Find or create a label"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && q && !all.some((l) => l.name.toLowerCase() === q)) {
                createLabel.mutate(
                  { name: query.trim(), color: STATUS_COLORS[all.length % STATUS_COLORS.length] },
                  { onSuccess: (l) => (toggle(l.id), setQuery("")) },
                );
              }
            }}
            placeholder="Find or create a label…"
            className="mb-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
          />
          <div className="max-h-60 overflow-y-auto">
            {shown.map((l) => (
              <PopoverItem
                key={l.id}
                icon={
                  <span className={cn("flex size-3.5 items-center justify-center rounded border", applied.has(l.id) ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                    {applied.has(l.id) && <Check className="size-2.5" />}
                  </span>
                }
                label={
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: l.color }} />
                    {l.name}
                  </span>
                }
                onClick={() => toggle(l.id)}
              />
            ))}
            {q && !all.some((l) => l.name.toLowerCase() === q) && (
              <p className="px-2 py-1.5 text-[12px] text-muted-foreground">Enter creates “{query.trim()}”.</p>
            )}
            {!q && all.length === 0 && <p className="px-2 py-1.5 text-[12px] text-muted-foreground">Type to create your first label.</p>}
          </div>
        </>
      )}
    </Popover>
  );
}

function Checklist({ d }: { d: Detail }) {
  const add = useAddChecklistItem();
  const update = useUpdateChecklistItem();
  const remove = useDeleteChecklistItem();
  const [body, setBody] = useState("");
  const done = d.checklist.filter((c) => c.done).length;
  return (
    <Section title="Checklist" count={d.checklist.length}>
      {d.checklist.length > 0 && (
        <div className="mb-2 flex items-center gap-2" aria-label={`${done} of ${d.checklist.length} done`}>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-accent">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(done / d.checklist.length) * 100}%` }} />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {done}/{d.checklist.length}
          </span>
        </div>
      )}
      <ul className="flex flex-col">
        {d.checklist.map((c) => (
          <li key={c.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent/50">
            <input
              type="checkbox"
              checked={c.done}
              aria-label={c.body}
              onChange={(e) => update.mutate({ id: c.id, done: e.target.checked })}
              className="size-4 cursor-pointer accent-primary"
            />
            <span className={cn("flex-1 text-sm", c.done && "text-muted-foreground line-through")}>{c.body}</span>
            <button
              type="button"
              aria-label={`Delete ${c.body}`}
              onClick={() => remove.mutate(c.id)}
              className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-1 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) add.mutate({ taskId: d.id, body: body.trim() }, { onSuccess: () => setBody("") });
        }}
      >
        <Plus className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-label="New checklist item"
          placeholder="Add an item"
          className="h-7 flex-1 rounded-md border border-transparent bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground focus:border-input"
        />
      </form>
    </Section>
  );
}

function Dependencies({ d, onOpen }: { d: Detail; onOpen: (id: string) => void }) {
  const { data: all } = useLocalTasks({});
  const create = useCreateLocalRelation();
  const remove = useDeleteLocalRelation();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"blocks" | "related" | "blocked_by">("blocks");
  const q = query.trim().toLowerCase();
  const candidates = (all ?? [])
    .filter((t) => t.id !== d.id && (!q || t.title.toLowerCase().includes(q) || t.identifier.toLowerCase().includes(q)))
    .slice(0, 8);
  const groups = ["blocks", "blocked_by", "related"]
    .map((type) => ({ type, items: d.relations.filter((r) => r.type === type) }))
    .filter((g) => g.items.length > 0);
  const link = (otherId: string) =>
    kind === "blocked_by"
      ? create.mutate({ taskId: otherId, relatedId: d.id, kind: "blocks" })
      : create.mutate({ taskId: d.id, relatedId: otherId, kind });

  return (
    <Section
      title="Dependencies"
      count={d.relations.length}
      action={
        <Popover
          align="end"
          buttonTitle="Add dependency"
          buttonClassName="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          panelClassName="w-80 rounded-md border border-border bg-popover p-2 shadow-2xl"
          button={
            <>
              <Plus className="size-3.5" /> Add
            </>
          }
        >
          {(close) => (
            <>
              <div role="radiogroup" aria-label="Dependency type" className="mb-2 inline-flex rounded-md border border-border p-0.5 text-xs">
                {(["blocks", "blocked_by", "related"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={kind === k}
                    onClick={() => setKind(k)}
                    className={cn("cursor-pointer rounded-[5px] px-2 py-1", kind === k ? "bg-accent text-foreground" : "text-muted-foreground")}
                  >
                    {RELATION_LABEL[k]}
                  </button>
                ))}
              </div>
              <input
                autoFocus
                aria-label="Find a task"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a task…"
                className="mb-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
              />
              {candidates.map((t) => (
                <PopoverItem
                  key={t.id}
                  icon={<StatusIcon type={t.stateType} color={t.stateColor} />}
                  label={
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">{t.identifier}</span>
                      <span className="truncate">{t.title}</span>
                    </span>
                  }
                  onClick={() => (link(t.id), setQuery(""), close())}
                />
              ))}
              {candidates.length === 0 && <p className="px-2 py-1.5 text-[12px] text-muted-foreground">No matching tasks.</p>}
            </>
          )}
        </Popover>
      }
    >
      {groups.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No dependencies. Link tasks this one blocks, waits on, or relates to.</p>
      ) : (
        groups.map((g) => (
          <div key={g.type} className="mb-2">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">{RELATION_LABEL[g.type]}</p>
            {g.items.map((r) => (
              <div key={`${g.type}-${r.relatedId}`} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent/50">
                <StatusIcon type={r.relatedStateType ?? "unstarted"} color={r.relatedStateColor ?? ""} />
                <button type="button" onClick={() => onOpen(r.relatedId)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-sm focus-visible:outline-none focus-visible:underline">
                  <span className="font-mono text-[11px] text-muted-foreground">{r.relatedIdentifier}</span>
                  <span className="truncate">{r.relatedTitle}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${r.relatedIdentifier}`}
                  onClick={() => remove.mutate({ taskId: d.id, relatedId: r.relatedId, kind: r.type })}
                  className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        ))
      )}
    </Section>
  );
}

function Links({ d }: { d: Detail }) {
  const add = useAddLocalAttachment();
  const remove = useDeleteLocalAttachment();
  const [url, setUrl] = useState("");
  return (
    <Section title="Links" count={d.attachments.length}>
      <ul className="flex flex-col">
        {d.attachments.map((a) => (
          <li key={a.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent/50">
            <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
            <button type="button" onClick={() => openExternal(a.url)} className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm text-primary hover:underline focus-visible:outline-none focus-visible:underline">
              {a.title}
            </button>
            <ExternalLink aria-hidden className="size-3 text-muted-foreground" />
            <button
              type="button"
              aria-label={`Remove ${a.title}`}
              onClick={() => remove.mutate(a.id)}
              className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-1 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) add.mutate({ taskId: d.id, url: url.trim() }, { onSuccess: () => setUrl("") });
        }}
      >
        <Plus className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="Link URL"
          placeholder="Paste a link and press Enter"
          className="h-7 flex-1 rounded-md border border-transparent bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground focus:border-input"
        />
      </form>
    </Section>
  );
}

function CommentItem({ c }: { c: LocalComment }) {
  const update = useUpdateLocalComment();
  const remove = useDeleteLocalComment();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(c.body);
  return (
    <li className="group rounded-[10px] border border-border bg-card px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">You</span>
        <span>{timeAgo(c.createdAt)}</span>
        {c.updatedAt !== c.createdAt && <span>(edited)</span>}
        <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          <button type="button" onClick={() => setEditing(true)} className="cursor-pointer rounded px-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Edit
          </button>
          <button type="button" onClick={() => remove.mutate(c.id)} className="cursor-pointer rounded px-1 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Delete
          </button>
        </div>
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            aria-label="Edit comment"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            className="w-full resize-y rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus:border-ring"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="xs" onClick={() => (setBody(c.body), setEditing(false))}>
              Cancel
            </Button>
            <Button size="xs" disabled={!body.trim()} onClick={() => update.mutate({ id: c.id, body: body.trim() }, { onSuccess: () => setEditing(false) })}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <ReadOnlyDescription markdown={c.body} onOpenLink={openExternal} />
      )}
    </li>
  );
}

function Comments({ d }: { d: Detail }) {
  const add = useAddLocalComment();
  const [body, setBody] = useState("");
  const post = () => body.trim() && add.mutate({ taskId: d.id, body: body.trim() }, { onSuccess: () => setBody("") });
  return (
    <Section title="Comments" count={d.comments.length}>
      <ul className="mb-3 flex flex-col gap-2">
        {d.comments.map((c) => (
          <CommentItem key={c.id} c={c} />
        ))}
      </ul>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            post();
          }
        }}
        aria-label="New comment"
        placeholder="Write a note (Markdown). Ctrl/⌘+Enter to post."
        rows={3}
        className="w-full resize-y rounded-[10px] border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-[3px] focus:ring-ring/50"
      />
      <div className="mt-2 flex justify-end">
        <Button size="sm" disabled={!body.trim() || add.isPending} onClick={post}>
          Comment
        </Button>
      </div>
    </Section>
  );
}

/** The ClickUp-style body of a local task, in the drawer or a full-page tab. */
export function LocalTaskDetail({ id, mode, onClose }: { id: string; mode: "drawer" | "page"; onClose: () => void }) {
  const { data: d, isError } = useLocalTaskDetail(id);
  const { data: tree } = useLocalTree();
  const update = useUpdateTask();
  const del = useDeleteTask();
  const [, setParams] = useSearchParams();
  const { openIssueTab } = useWorkspace();
  const [title, setTitle] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (d) setTitle(d.title);
    setConfirmDelete(false);
  }, [d?.id, d?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [title]);

  const patch = useCallback((p: TaskPatch) => update.mutate({ id, patch: p }), [update, id]);
  const open = (next: string) => setParams({ issue: next });

  if (isError) {
    return (
      <div className="flex h-full flex-col items-start gap-3 p-6">
        <p className="text-sm text-muted-foreground">This task no longer exists, or Local tasks is turned off.</p>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }
  if (!d) {
    return mode === "page" ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div> : null;
  }

  const space = tree?.spaces.find((s) => s.id === d.spaceId);
  const sprints = tree?.sprints.filter((s) => s.spaceId === d.spaceId) ?? [];
  const saveTitle = () => {
    const t = title.trim();
    if (t && t !== d.title) patch({ title: t });
    else setTitle(d.title);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border/60 px-6 py-2.5">
        <span className="min-w-0 truncate text-[13px] text-muted-foreground">
          {space?.name} / {d.listName} · <span className="font-mono text-xs">{d.identifier}</span>
        </span>
        <div className="ml-auto flex items-center gap-1">
          {mode === "drawer" && (
            <Button variant="ghost" size="icon-sm" aria-label="Open as a tab" title="Open as a tab" onClick={() => (openIssueTab(id), onClose())}>
              <Maximize2 />
            </Button>
          )}
          {confirmDelete ? (
            <Button
              variant="destructive"
              size="sm"
              autoFocus
              onClick={() => del.mutate(id, { onSuccess: () => (setParams({}), onClose()) })}
            >
              Delete task{d.subtasks.length > 0 ? ` and ${d.subtasks.length} subtask${d.subtasks.length === 1 ? "" : "s"}` : ""}
            </Button>
          ) : (
            <Button variant="ghost" size="icon-sm" aria-label="Delete task" title="Delete task" onClick={() => setConfirmDelete(true)}>
              <Trash2 />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto pb-16">
        <div className="px-6 pb-4 pt-5">
          {d.parent && (
            <button type="button" onClick={() => open(d.parent!.id)} className="mb-2 flex cursor-pointer items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:underline">
              Subtask of <span className="font-mono text-xs">{d.parent.identifier}</span> {d.parent.title}
            </button>
          )}
          <textarea
            ref={titleRef}
            value={title}
            rows={1}
            aria-label="Title"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            className="w-full resize-none overflow-hidden bg-transparent text-lg font-semibold tracking-tight text-foreground outline-none"
          />
          <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-0.5 sm:grid-cols-2">
            <Field label="Status">
              <StatusSelect statuses={d.statuses} value={d.stateId} onChange={(stateId) => patch({ stateId })} />
            </Field>
            <Field label="Assignee">
              <AssigneeToggle value={d.assigneeId} onChange={(assigneeId) => patch({ assigneeId })} />
            </Field>
            <Field label="Start">
              <DatePicker value={d.startDate} placeholder="No start date" onChange={(startDate) => patch({ startDate })} />
            </Field>
            <Field label="Due">
              <DatePicker value={d.dueDate} onChange={(dueDate) => patch({ dueDate })} />
            </Field>
            <Field label="Priority">
              <PrioritySelect value={d.priority} onChange={(priority) => patch({ priority })} />
            </Field>
            <Field label="Estimate">
              <input
                key={`${d.id}-${d.estimate}`}
                type="number"
                min={0}
                step={0.5}
                aria-label="Estimate in points"
                placeholder="Points"
                defaultValue={d.estimate ?? ""}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  const next = v === "" ? null : Number(v);
                  if (next !== d.estimate && (next === null || Number.isFinite(next))) patch({ estimate: next });
                }}
                className="h-8 w-24 rounded-md border border-transparent bg-transparent px-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground hover:bg-accent focus:border-input"
              />
            </Field>
            <Field label="Sprint">
              <SprintSelect sprints={sprints} value={d.sprintId} onChange={(cycleId) => patch({ cycleId })} />
            </Field>
            <Field label="Labels">
              <LabelsField d={d} onChange={(labelIds) => patch({ labelIds })} />
            </Field>
          </div>
        </div>
        <section className="border-t border-border/60 px-6 py-4">
          <h3 className="mb-2 text-[13px] font-semibold tracking-tight text-foreground">Description</h3>
          <DescriptionEditor
            key={d.id}
            markdown={d.description ?? ""}
            editable
            allowAttach={false}
            onSave={async (md) => {
              await update.mutateAsync({ id, patch: { description: md }, silent: true });
            }}
            onSaveError={() => gooeyToast.error("Couldn't save description")}
            onSaveStateChange={(s) => {
              if (s === "error") gooeyToast.error("Couldn't save description");
            }}
            onOpenLink={openExternal}
          />
        </section>
        <Section title="Subtasks" count={d.subtasks.length}>
          <ul className="flex flex-col">
            {d.subtasks.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent/50">
                <StatusSelect compact statuses={d.statuses} value={s.stateId} onChange={(stateId) => update.mutate({ id: s.id, patch: { stateId } })} />
                <button type="button" onClick={() => open(s.id)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-sm focus-visible:outline-none focus-visible:underline">
                  <span className="font-mono text-[11px] text-muted-foreground">{s.identifier}</span>
                  <span className={cn("truncate", (s.stateType === "completed" || s.stateType === "canceled") && "text-muted-foreground line-through")}>{s.title}</span>
                </button>
              </li>
            ))}
          </ul>
          <QuickAdd base={{ listId: d.teamId ?? "", parentId: d.id }} label="Add subtask" className="px-1" />
        </Section>
        <Checklist d={d} />
        <Dependencies d={d} onOpen={open} />
        <Links d={d} />
        <Comments d={d} />
        <p className="px-6 pt-2 text-[11px] text-muted-foreground">
          Created {timeAgo(d.createdAt)} · Updated {timeAgo(d.updatedAt)}
        </p>
      </div>
    </div>
  );
}
