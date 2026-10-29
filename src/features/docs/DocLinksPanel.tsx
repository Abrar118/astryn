import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { gooeyToast } from "goey-toast";
import { Check, FileText, Link2, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorText, type DocLink, type DocLinkInput, type DocLinkKind, type DocsSource } from "@/lib/commands";
import { useCreateDocLink, useDeleteDocLink, useDocLinks, useUpdateDocLink } from "@/lib/docLinkQueries";
import { useDocsSources, useDocsTree } from "@/lib/queries";
import { safeExternalUrl } from "@/lib/links";
import { useWorkspace } from "@/lib/tabs";
import type { TrackerId } from "@/lib/tracker";
import { cn } from "@/lib/utils";
import { docChoices, linkDetail, linkInputProblem, linkLabel, parseTags } from "./docLinks";
import { SourceKindIcon } from "./SourceKindIcon";

const FIELD = "text-sm md:text-sm";
/** Focus target meaning the section's Add button. */
const ADD = "\u0000add";
const ROW_ACTION =
  "dash-control flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-background/60 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100";

function openExternal(href: string) {
  const url = safeExternalUrl(href);
  if (url) openUrl(url).catch(() => gooeyToast.error("Couldn't open the link"));
  else gooeyToast.error("Blocked unsafe link");
}

/** The document picker: a source, then a filterable list of its documents (combobox). */
function DocPicker({
  sources,
  sourceId,
  path,
  onChange,
}: {
  sources: DocsSource[];
  sourceId: string | null;
  path: string | null;
  onChange: (sourceId: string, path: string | null, label?: string) => void;
}) {
  const listId = useId();
  const source = sources.find((s) => s.id === sourceId);
  const tree = useDocsTree(source?.available ? source.id : null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const choices = docChoices(tree.data ?? [], query).slice(0, 50);
  const activeChoice = choices[Math.min(active, choices.length - 1)];

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.max(0, Math.min(choices.length - 1, i + step)));
    } else if (e.key === "Enter" && activeChoice) {
      e.preventDefault();
      onChange(source!.id, activeChoice.path, activeChoice.label);
    }
  };

  let status: string | null = null;
  if (!source) status = sourceId ? "This link's source was removed. Saving keeps the current document." : null;
  else if (!source.available) status = "This source can't be read right now.";
  else if (tree.isError) status = "Couldn't read this source.";
  else if (!tree.data) status = "Loading documents…";
  else if (tree.data.length === 0)
    status = source.kind === "local" ? "No readable documents in this folder." : "Nothing cached yet. Open this source in Docs to sync it.";
  else if (choices.length === 0) status = "No matching documents.";

  return (
    <div className="flex flex-col gap-2">
      <select
        aria-label="Docs source"
        value={sourceId ?? ""}
        onChange={(e) => (setQuery(""), setActive(0), onChange(e.target.value, null))}
        className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      >
        {sourceId && !source && <option value={sourceId}>Removed source</option>}
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.available ? s.name : `${s.name} (unavailable)`}
          </option>
        ))}
      </select>
      <Input
        role="combobox"
        aria-label="Find a document"
        aria-expanded={choices.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeChoice ? `${listId}-${choices.indexOf(activeChoice)}` : undefined}
        value={query}
        onChange={(e) => (setQuery(e.target.value), setActive(0))}
        onKeyDown={onKey}
        placeholder="Find a document…"
        className={FIELD}
      />
      <ul id={listId} role="listbox" aria-label="Documents" className="drawer-scrollbar max-h-48 overflow-y-auto">
        {choices.map((c, i) => {
          const chosen = c.path === path;
          return (
            <li
              key={c.path}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={chosen}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange(source!.id, c.path, c.label)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                c === activeChoice ? "bg-accent text-foreground" : "text-foreground hover:bg-accent/50",
              )}
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center text-primary">{chosen && <Check className="size-3.5" />}</span>
              <span className="min-w-0 truncate">{c.label}</span>
              {c.trail && <span className="ml-auto min-w-0 shrink truncate text-[12px] text-muted-foreground">{c.trail}</span>}
            </li>
          );
        })}
      </ul>
      {status && <p className="px-1 text-[12px] text-muted-foreground">{status}</p>}
    </div>
  );
}

/** Add or edit form. `link` set = editing. */
function DocLinkForm({
  link,
  sources,
  onSubmit,
  onCancel,
}: {
  link?: DocLink;
  sources: DocsSource[] | undefined;
  /** Resolves once saved (the parent then closes the form); rejects to keep it open. */
  onSubmit: (input: DocLinkInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { setActiveView } = useWorkspace();
  // Readable sources, plus the edited link's own source so an unchanged target can be kept.
  const pickable = (sources ?? []).filter((s) => s.available || s.id === link?.sourceId);
  const [kind, setKind] = useState<DocLinkKind>(link?.kind ?? "url");
  const [url, setUrl] = useState(link?.url ?? "");
  const [chosenSource, setSourceId] = useState<string | null>(link?.sourceId ?? null);
  // Until the user picks one, default to the first readable source (sources may still be loading).
  const sourceId = chosenSource ?? pickable[0]?.id ?? null;
  const [path, setPath] = useState<string | null>(link?.docPath ?? null);
  const [docLabel, setDocLabel] = useState<string | null>(null);
  const [title, setTitle] = useState(link?.title ?? "");
  const [note, setNote] = useState(link?.note ?? "");
  const [tags, setTags] = useState(link?.tags.join(", ") ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ready = kind === "url" ? url.trim() !== "" : !!sourceId && !!path;
  const submit = () => {
    if (!ready || saving) return;
    const common = { title: title.trim() || docLabel || null, note: note.trim() || null, tags: parseTags(tags) };
    const input: DocLinkInput = kind === "url" ? { kind, url: url.trim(), ...common } : { kind, sourceId, docPath: path, ...common };
    const local = linkInputProblem(input);
    setProblem(local);
    if (local) return;
    setSaving(true);
    // On failure everything typed stays; the reason shows here (and as a toast).
    onSubmit(input).catch((err) => (setSaving(false), setProblem(errorText(err))));
  };

  return (
    <form
      aria-label={link ? "Edit link" : "Add a link"}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
      onSubmit={(e) => (e.preventDefault(), submit())}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation(); // keep the drawer open
          onCancel();
        }
      }}
    >
      <div className="inline-flex self-start gap-0.5 rounded-md bg-sidebar p-0.5 text-[12px]">
        {(
          [
            ["url", "Web link"],
            ["doc", "Doc"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              "dash-control rounded-[6px] px-2.5 py-1 transition-colors",
              kind === k ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {kind === "url" ? (
        <Input autoFocus aria-label="URL" placeholder="https://…" maxLength={2048} value={url} onChange={(e) => setUrl(e.target.value)} className={FIELD} />
      ) : pickable.length === 0 && !sourceId ? (
        <div className="flex items-center gap-2 px-1">
          <p className="flex-1 text-[13px] text-muted-foreground">
            {!sources
              ? "Loading sources…"
              : sources.length === 0
                ? "No docs sources yet."
                : "Your docs sources can't be read right now. Turn their provider back on in Settings → Modules."}
          </p>
          {sources && (
            <Button type="button" variant="ghost" size="xs" onClick={() => setActiveView("docs")}>
              Open Docs
            </Button>
          )}
        </div>
      ) : (
        <DocPicker
          sources={pickable}
          sourceId={sourceId}
          path={path}
          onChange={(s, p, label) => (setSourceId(s), setPath(p), setDocLabel(label ?? null))}
        />
      )}
      <Input
        aria-label="Title"
        placeholder={docLabel ? `Title (${docLabel})` : "Title (optional)"}
        maxLength={200}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className={FIELD}
      />
      <textarea
        aria-label="Note"
        placeholder="Note (optional)"
        maxLength={4000}
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      />
      <Input aria-label="Tags" placeholder="Tags, comma-separated" maxLength={900} value={tags} onChange={(e) => setTags(e.target.value)} className={FIELD} />
      {problem && (
        <p role="alert" className="px-1 text-[13px] text-destructive">
          {problem}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!ready || saving}>
          {link ? "Save" : "Add link"}
        </Button>
      </div>
    </form>
  );
}

function DocLinkRow({
  link,
  sources,
  onOpenDoc,
  onEdit,
  onRemove,
}: {
  link: DocLink;
  sources: DocsSource[] | undefined;
  onOpenDoc: (sourceId: string, path: string) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const label = linkLabel(link);
  const { text, blocked } = linkDetail(link, sources);
  const pending = link.id.startsWith("pending-");
  const source = link.kind === "doc" ? sources?.find((s) => s.id === link.sourceId) : undefined;
  const open = () => {
    if (link.kind === "url") openExternal(link.url ?? "");
    else if (link.sourceId && link.docPath) onOpenDoc(link.sourceId, link.docPath);
  };
  const icon =
    link.kind === "url" ? <Link2 className="size-4" /> : source ? <SourceKindIcon kind={source.kind} className="size-4" /> : <FileText className="size-4" />;

  return (
    <li data-link-row={link.id} className={cn("group -mx-2 flex items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent", pending && "opacity-60")}>
      <span aria-hidden className="mt-0.5 shrink-0 text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={open}
          disabled={pending || !!blocked}
          className="dash-control block max-w-full cursor-pointer truncate rounded-sm text-left text-sm font-medium text-foreground underline decoration-muted-foreground/70 underline-offset-[3px] hover:decoration-foreground disabled:cursor-default disabled:font-normal disabled:no-underline"
        >
          {label}
        </button>
        <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
          {text}
          {blocked && <span> · {blocked}</span>}
        </p>
        {link.note && <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-muted-foreground">{link.note}</p>}
        {link.tags.length > 0 && (
          <ul aria-label="Tags" className="mt-1.5 flex flex-wrap gap-1">
            {link.tags.map((t) => (
              <li key={t} className="rounded-full border border-border px-2 py-px text-[12px] text-muted-foreground">
                {t}
              </li>
            ))}
          </ul>
        )}
      </div>
      {!pending && (
        <div className="flex shrink-0 items-center">
          <button type="button" aria-label={`Edit ${label}`} title="Edit" onClick={onEdit} className={ROW_ACTION}>
            <Pencil className="size-3.5" />
          </button>
          <button type="button" aria-label={`Remove ${label}`} title="Remove" onClick={onRemove} className={cn(ROW_ACTION, "hover:text-destructive")}>
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * F9 "Docs & links" for one task of any tracker: web links and documents from
 * any docs source, each with an optional title, note and tags. The tracker
 * body frames it; this renders the heading, list and form. `onNavigate` runs
 * after a doc opens in a Docs tab (the drawer closes itself with it).
 */
export function DocLinksPanel({ tracker, taskId, onNavigate }: { tracker: TrackerId; taskId: string; onNavigate?: () => void }) {
  const headingId = useId();
  const { data: links, isError } = useDocLinks(tracker, taskId);
  const { data: sources } = useDocsSources();
  const { openDocTab } = useWorkspace();
  const create = useCreateDocLink(tracker, taskId);
  const update = useUpdateDocLink(tracker, taskId);
  const remove = useDeleteDocLink(tracker, taskId);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  // Where keyboard focus goes once the next render lands: a row (by link id) or
  // the Add button, so closing a form or removing a row never drops it to <body>.
  const sectionRef = useRef<HTMLElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<string | null>(null);
  const focusTarget = (target: string) =>
    target === ADD
      ? addRef.current
      : sectionRef.current?.querySelector<HTMLButtonElement>(`[data-link-row="${CSS.escape(target)}"] button:not(:disabled)`);
  useEffect(() => {
    const el = focusNext.current && focusTarget(focusNext.current);
    if (el) {
      el.focus();
      focusNext.current = null;
    }
  });
  const closeAdd = () => ((focusNext.current = ADD), setAdding(false));
  const closeEdit = (id: string) => ((focusNext.current = id), setEditing(null));
  // The next row (or Add) is already on screen, so focus moves before the row goes.
  const removeLink = (id: string) => {
    const all = links ?? [];
    const next = all[all.findIndex((l) => l.id === id) + 1];
    focusTarget(next ? next.id : ADD)?.focus();
    remove.mutate(id);
  };

  const openDoc = (sourceId: string, path: string) => {
    openDocTab(sourceId, path);
    onNavigate?.();
  };

  return (
    <section ref={sectionRef} aria-labelledby={headingId}>
      <div className="mb-2 flex min-h-8 items-center gap-2">
        <h3 id={headingId} className="text-[13px] font-semibold tracking-tight text-foreground">
          Docs & links
        </h3>
        {!!links?.length && <span className="text-[13px] tabular-nums text-muted-foreground">{links.length}</span>}
        {!adding && links && (
          <Button ref={addRef} variant="ghost" size="xs" className="ml-auto text-muted-foreground" onClick={() => (setEditing(null), setAdding(true))}>
            <Plus /> Add
          </Button>
        )}
      </div>
      {!links && isError && <p className="text-[13px] text-muted-foreground">Couldn't load this task's links.</p>}
      {links && links.length > 0 && (
        <ul className="mb-2 flex flex-col">
          {links.map((l) =>
            editing === l.id ? (
              <li key={l.id}>
                <DocLinkForm
                  link={l}
                  sources={sources}
                  onCancel={() => closeEdit(l.id)}
                  onSubmit={(input) => update.mutateAsync({ id: l.id, input }).then(() => closeEdit(l.id))}
                />
              </li>
            ) : (
              <DocLinkRow
                key={l.id}
                link={l}
                sources={sources}
                onOpenDoc={openDoc}
                onEdit={() => (setAdding(false), setEditing(l.id))}
                onRemove={() => removeLink(l.id)}
              />
            ),
          )}
        </ul>
      )}
      {links?.length === 0 && !adding && (
        <p className="text-[13px] text-muted-foreground">No docs or links yet. Attach a spec, a page from Docs, or any web link.</p>
      )}
      {adding && (
        <DocLinkForm sources={sources} onCancel={closeAdd} onSubmit={(input) => create.mutateAsync(input).then(closeAdd)} />
      )}
    </section>
  );
}
