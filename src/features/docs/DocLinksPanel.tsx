import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { gooeyToast } from "goey-toast";
import { Check, FileText, Link2, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DocLink, DocLinkInput, DocLinkKind, DocsSource } from "@/lib/commands";
import { useCreateDocLink, useDeleteDocLink, useDocLinks, useUpdateDocLink } from "@/lib/docLinkQueries";
import { useDocsSources, useDocsTree } from "@/lib/queries";
import { safeExternalUrl } from "@/lib/links";
import { useWorkspace } from "@/lib/tabs";
import type { TrackerId } from "@/lib/tracker";
import { cn } from "@/lib/utils";
import { docChoices, linkDetail, linkLabel, parseTags } from "./docLinks";
import { SourceKindIcon } from "./SourceKindIcon";

const FIELD = "text-sm md:text-sm";
const ROW_ACTION =
  "rounded p-1 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100";

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
              {c.trail && <span className="ml-auto min-w-0 shrink truncate text-[11px] text-muted-foreground">{c.trail}</span>}
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
  onSubmit: (input: DocLinkInput) => void;
  onCancel: () => void;
}) {
  const { setActiveView } = useWorkspace();
  // Readable sources, plus the edited link's own source so an unchanged target can be kept.
  const pickable = (sources ?? []).filter((s) => s.available || s.id === link?.sourceId);
  const [kind, setKind] = useState<DocLinkKind>(link?.kind ?? "url");
  const [url, setUrl] = useState(link?.url ?? "");
  const [sourceId, setSourceId] = useState<string | null>(link?.sourceId ?? pickable[0]?.id ?? null);
  const [path, setPath] = useState<string | null>(link?.docPath ?? null);
  const [docLabel, setDocLabel] = useState<string | null>(null);
  const [title, setTitle] = useState(link?.title ?? "");
  const [note, setNote] = useState(link?.note ?? "");
  const [tags, setTags] = useState(link?.tags.join(", ") ?? "");

  const ready = kind === "url" ? url.trim() !== "" : !!sourceId && !!path;
  const submit = () => {
    if (!ready) return;
    const common = { title: title.trim() || docLabel || null, note: note.trim() || null, tags: parseTags(tags) };
    onSubmit(kind === "url" ? { kind, url: url.trim(), ...common } : { kind, sourceId, docPath: path, ...common });
  };

  return (
    <form
      aria-label={link ? "Edit link" : "Add a link"}
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3"
      onSubmit={(e) => (e.preventDefault(), submit())}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation(); // keep the drawer open
          onCancel();
        }
      }}
    >
      <div className="inline-flex self-start rounded-md border border-border p-0.5 text-xs">
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
              "cursor-pointer rounded-[5px] px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              kind === k ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
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
          <p className="flex-1 text-[13px] text-muted-foreground">{sources ? "No docs sources yet." : "Loading sources…"}</p>
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
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!ready}>
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
    <li className={cn("group flex items-start gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-accent/50", pending && "opacity-60")}>
      <span aria-hidden className="mt-0.5 shrink-0 text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={open}
          disabled={pending || !!blocked}
          className="block max-w-full cursor-pointer truncate text-left text-sm text-primary hover:underline focus-visible:underline focus-visible:outline-none disabled:cursor-default disabled:text-foreground disabled:no-underline"
        >
          {label}
        </button>
        <p className="truncate text-[11px] text-muted-foreground">
          {text}
          {blocked && <span> · {blocked}</span>}
        </p>
        {link.note && <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-muted-foreground">{link.note}</p>}
        {link.tags.length > 0 && (
          <ul aria-label="Tags" className="mt-1.5 flex flex-wrap gap-1">
            {link.tags.map((t) => (
              <li key={t} className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
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
  // When the add form closes, keyboard focus goes back to the Add button.
  const addRef = useRef<HTMLButtonElement>(null);
  const wasAdding = useRef(false);
  useEffect(() => {
    if (wasAdding.current && !adding) addRef.current?.focus();
    wasAdding.current = adding;
  }, [adding]);

  const openDoc = (sourceId: string, path: string) => {
    openDocTab(sourceId, path);
    onNavigate?.();
  };

  return (
    <section aria-labelledby={headingId}>
      <div className="mb-2 flex min-h-8 items-center gap-2">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">
          Docs & links
        </h3>
        {!!links?.length && <span className="text-sm tabular-nums text-muted-foreground">{links.length}</span>}
        {!adding && links && (
          <Button ref={addRef} variant="ghost" size="xs" className="ml-auto text-muted-foreground" onClick={() => (setEditing(null), setAdding(true))}>
            <Plus /> Add
          </Button>
        )}
      </div>
      {!links && isError && <p className="text-[13px] text-muted-foreground">Couldn't load this task's links.</p>}
      {links && links.length > 0 && (
        <ul className="mb-2 flex flex-col gap-0.5">
          {links.map((l) =>
            editing === l.id ? (
              <li key={l.id}>
                <DocLinkForm
                  link={l}
                  sources={sources}
                  onCancel={() => setEditing(null)}
                  onSubmit={(input) => (update.mutate({ id: l.id, input }), setEditing(null))}
                />
              </li>
            ) : (
              <DocLinkRow
                key={l.id}
                link={l}
                sources={sources}
                onOpenDoc={openDoc}
                onEdit={() => (setAdding(false), setEditing(l.id))}
                onRemove={() => remove.mutate(l.id)}
              />
            ),
          )}
        </ul>
      )}
      {links?.length === 0 && !adding && (
        <p className="text-[13px] text-muted-foreground">No docs or links yet. Attach a spec, a page from Docs, or any web link.</p>
      )}
      {adding && (
        <DocLinkForm sources={sources} onCancel={() => setAdding(false)} onSubmit={(input) => (create.mutate(input), setAdding(false))} />
      )}
    </section>
  );
}
