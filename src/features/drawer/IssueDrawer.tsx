import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { gooeyToast } from "goey-toast";
import {
  Box,
  Calendar,
  Check,
  Copy,
  ExternalLink,
  Gauge,
  GitPullRequest,
  IterationCcw,
  Link2,
  MoreHorizontal,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import {
  useCycles,
  useDeleteIssue,
  useFilterOptions,
  useIssueDetail,
  useLabels,
  useUpdateIssue,
  useUsers,
} from "@/lib/queries";
import type { CalendarIssue, IssueDetailResult, LiveDetail, UpdateIssuePatch } from "@/lib/commands";
import { AssigneeSelect } from "@/components/AssigneeSelect";
import { Avatar } from "@/components/Avatar";

const PRIORITIES = [
  { value: 0, label: "No priority", color: "#6b7280" },
  { value: 1, label: "Urgent", color: "#ef4444" },
  { value: 2, label: "High", color: "#f97316" },
  { value: 3, label: "Medium", color: "#eab308" },
  { value: 4, label: "Low", color: "#3b82f6" },
];
const ESTIMATES = [0, 1, 2, 3, 5, 8];

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      ta.remove();
    }
  }
  gooeyToast.success(`${label} copied`);
}

function useSeed(id: string | null): CalendarIssue | undefined {
  const qc = useQueryClient();
  if (!id) return undefined;
  for (const key of [["calendar"], ["unscheduled"]] as const) {
    for (const [, list] of qc.getQueriesData<CalendarIssue[]>({ queryKey: key })) {
      const found = list?.find((i) => i.id === id);
      if (found) return found;
    }
  }
  return undefined;
}

/** Linear-style status glyph derived from the workflow state type + color. */
function StatusIcon({ type, color }: { type: string; color: string }) {
  const c = color || "#6b7280";
  if (type === "completed")
    return (
      <svg viewBox="0 0 14 14" className="size-3.5">
        <circle cx="7" cy="7" r="6" fill={c} />
        <path d="M4.2 7.2l1.8 1.8 3.8-3.8" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (type === "canceled")
    return (
      <svg viewBox="0 0 14 14" className="size-3.5">
        <circle cx="7" cy="7" r="6" fill="#6b7280" />
        <path d="M4.8 4.8l4.4 4.4M9.2 4.8l-4.4 4.4" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  const fill = type === "started" ? 0.55 : 0;
  return (
    <svg viewBox="0 0 14 14" className="size-3.5">
      <circle cx="7" cy="7" r="5.5" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray={type === "backlog" ? "2 1.6" : undefined} />
      {fill > 0 && <circle cx="7" cy="7" r="3.1" fill="none" stroke={c} strokeWidth="3.4" strokeDasharray={`${fill * 19.5} 19.5`} transform="rotate(-90 7 7)" />}
    </svg>
  );
}

const priorityIcon = (value: number) => {
  const p = PRIORITIES.find((x) => x.value === value) ?? PRIORITIES[0];
  return <span className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />;
};

export function IssueDrawer() {
  const [params, setParams] = useSearchParams();
  const id = params.get("issue");
  const [shownId, setShownId] = useState<string | null>(id);
  const [open, setOpen] = useState(false);

  // Keep the panel mounted through its slide-out: clear the visible id only
  // after the exit transition finishes.
  useEffect(() => {
    if (id) {
      setShownId(id);
      const r = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(r);
    }
    setOpen(false);
    const t = setTimeout(() => setShownId(null), 220);
    return () => clearTimeout(t);
  }, [id]);

  if (!shownId) return null;
  return <DrawerShell id={shownId} open={open} onClose={() => setParams({})} />;
}

function DrawerShell({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const seed = useSeed(id);
  const { data: result } = useIssueDetail(id, seed);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-30">
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 motion-reduce:transition-none ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <aside
        className={`absolute right-0 top-0 flex h-full w-[min(940px,95vw)] flex-col border-l border-border bg-popover shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {result ? <DrawerContent id={id} result={result} onClose={onClose} /> : null}
      </aside>
    </div>
  );
}

function DrawerContent({ id, result, onClose }: { id: string; result: IssueDetailResult; onClose: () => void }) {
  const [, setParams] = useSearchParams();
  const update = useUpdateIssue();
  const del = useDeleteIssue();
  const users = useUsers();
  const { data: labels } = useLabels();
  const { data: cycles } = useCycles();
  const { data: filterOpts } = useFilterOptions();

  const live = result.source === "live" ? (result.detail as LiveDetail) : null;
  const editable = result.source === "live";
  const d = result.detail;

  // Fields shared by all branches (CalendarIssue | Issue | LiveDetail).
  const identifier = d.identifier;
  const priority = d.priority;
  const dueDate = d.dueDate;
  const projectId = d.projectId;
  // Rich fields exist only on the cache/live branches; preview (CalendarIssue) lacks them.
  const url = "url" in d ? d.url : null;
  const projectName = "projectName" in d ? d.projectName : null;
  const estimate = "estimate" in d ? d.estimate : null;
  const cycleName = "cycleName" in d ? d.cycleName : null;
  const cycleNumber = "cycleNumber" in d ? d.cycleNumber : null;
  const linkCount = "linkCount" in d ? d.linkCount : 0;
  const prCount = "prCount" in d ? d.prCount : 0;

  const detailTitle = d.title;
  const detailDesc = "description" in d ? d.description ?? "" : "";
  const [title, setTitle] = useState(detailTitle);
  const [desc, setDesc] = useState(detailDesc);
  const [editingDesc, setEditingDesc] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTitle(detailTitle);
    setDesc(detailDesc);
  }, [id, result.source, detailTitle, detailDesc]);

  // Auto-grow the title textarea to its content.
  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [title]);

  const patch = (p: UpdateIssuePatch) => update.mutate({ id, patch: p });
  const openIssue = (next: string) => setParams({ issue: next });

  const teamCycles = useMemo(
    () =>
      (cycles ?? [])
        .filter((c) => c.teamId === d.teamId)
        .sort((a, b) => (b.number ?? 0) - (a.number ?? 0)),
    [cycles, d.teamId],
  );

  const stateColor = "stateColor" in d ? d.stateColor : "#6b7280";
  const stateType = d.stateType;
  const stateName = "stateName" in d ? d.stateName ?? stateType : stateType;
  const cycleLabel = cycleName ?? (cycleNumber != null ? `Cycle ${cycleNumber}` : null);

  return (
    <>
      {/* Breadcrumb / action header */}
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm">
        <Box className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-muted-foreground">{projectName ?? d.teamKey ?? "Issue"}</span>
        <span className="text-border">›</span>
        <span className="shrink-0 font-medium text-foreground">{identifier}</span>
        <span className="min-w-0 truncate text-muted-foreground">{detailTitle}</span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <IconBtn title="Copy link" onClick={() => copyText(url ?? identifier, "Link")}>
            <Link2 className="size-4" />
          </IconBtn>
          <IconBtn title="Copy ID" onClick={() => copyText(identifier, "ID")}>
            <Copy className="size-4" />
          </IconBtn>
          {url && (
            <IconBtn title="Open in Linear" onClick={() => openUrl(url).catch(() => gooeyToast.error("Couldn't open the link"))}>
              <ExternalLink className="size-4" />
            </IconBtn>
          )}
          <OverflowMenu
            onCopyId={() => copyText(identifier, "ID")}
            onCopyLink={() => copyText(url ?? identifier, "Link")}
            onOpenLinear={url ? () => openUrl(url).catch(() => gooeyToast.error("Couldn't open the link")) : undefined}
            onDelete={
              editable
                ? () => {
                    del.mutate(id);
                    onClose();
                  }
                : undefined
            }
          />
          <IconBtn title="Close" onClick={onClose}>
            <X className="size-4" />
          </IconBtn>
        </div>
      </header>

      {result.source !== "live" && (
        <p className="border-b border-border bg-secondary/40 px-4 py-1.5 text-xs text-muted-foreground">
          {result.source === "preview" ? "Loading…" : "Offline — showing cached data. Editing is disabled."}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Main column */}
        <div className="min-w-0 flex-1 overflow-y-auto px-7 py-6">
          <textarea
            ref={titleRef}
            rows={1}
            value={title}
            disabled={!editable}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => editable && title.trim() && title !== d.title && patch({ title: title.trim() })}
            className="w-full resize-none bg-transparent text-2xl font-semibold leading-snug text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-100"
          />

          {/* Parent / sub-issue reference */}
          {live?.parent && (
            <button
              type="button"
              onClick={() => openIssue(live.parent!.id)}
              className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Sub-issue of <span className="font-medium text-foreground">{live.parent.identifier}</span>
              <span className="truncate">{live.parent.title}</span>
            </button>
          )}

          {/* Description */}
          <section className="mt-6">
            {editable && (
              <div className="mb-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => setEditingDesc((v) => !v)}
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {editingDesc ? "Done" : "Edit"}
                </button>
              </div>
            )}
            {editingDesc && editable ? (
              <textarea
                autoFocus
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                onBlur={() => patch({ description: desc === "" ? null : desc })}
                placeholder="Add description…"
                className="min-h-48 w-full resize-y rounded-md border border-border bg-background p-3 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : (
              <div className="prose prose-sm prose-invert max-w-none prose-headings:font-semibold prose-a:text-primary">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{desc || "_No description_"}</ReactMarkdown>
              </div>
            )}
          </section>

          {/* Activity */}
          {live && (
            <section className="mt-8 border-t border-border pt-5">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Activity</h3>
              {live.comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No comments yet.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {live.comments.map((c) => (
                    <div key={c.id} className="flex gap-2.5">
                      <Avatar name={c.userName ?? "?"} size={24} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium text-foreground">{c.userName ?? "Unknown"}</span>
                          <span className="text-xs text-muted-foreground">{timeAgo(c.createdAt)}</span>
                        </div>
                        <div className="prose prose-sm prose-invert mt-0.5 max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.body}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  ))}
                  {live.hasMoreComments && <p className="text-xs text-muted-foreground">Showing the first 50 comments.</p>}
                </div>
              )}
            </section>
          )}
        </div>

        {/* Properties rail */}
        <aside className="w-[280px] shrink-0 overflow-y-auto border-l border-border bg-sidebar/40 px-3 py-4">
          <div className="mb-2 px-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Properties</div>

          {/* Status */}
          <Field
            label="Status"
            value={
              <span className="flex items-center gap-2">
                <StatusIcon type={stateType} color={stateColor} />
                {stateName}
              </span>
            }
            disabled={!editable}
            menu={(close) =>
              (live?.teamStates ?? []).map((s) => (
                <Opt
                  key={s.id}
                  icon={<StatusIcon type={s.type} color={s.color} />}
                  label={s.name}
                  active={s.id === live?.stateId}
                  onClick={() => (patch({ stateId: s.id }), close())}
                />
              ))
            }
          />

          {/* Priority */}
          <Field
            label="Priority"
            value={
              <span className="flex items-center gap-2">
                {priorityIcon(priority)}
                {PRIORITIES.find((p) => p.value === priority)?.label ?? "No priority"}
              </span>
            }
            disabled={!editable}
            menu={(close) =>
              PRIORITIES.map((p) => (
                <Opt
                  key={p.value}
                  icon={<span className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />}
                  label={p.label}
                  active={p.value === priority}
                  onClick={() => (patch({ priority: p.value }), close())}
                />
              ))
            }
          />

          {/* Assignee */}
          <div className="flex items-center gap-2 px-1.5 py-1">
            <AssigneeSelect
              value={d.assigneeId ?? null}
              onChange={(uid) => patch({ assigneeId: uid })}
              users={users.data ?? []}
              emptyLabel="Unassigned"
              disabled={!editable}
            />
          </div>

          {/* Estimate */}
          <Field
            label="Estimate"
            value={
              <span className="flex items-center gap-2">
                <Gauge className="size-3.5 text-muted-foreground" />
                {estimate != null ? `${estimate} ${estimate === 1 ? "Point" : "Points"}` : "No estimate"}
              </span>
            }
            disabled={!editable}
            menu={(close) => (
              <>
                <Opt icon={<Gauge className="size-4" />} label="No estimate" active={estimate == null} onClick={() => (patch({ estimate: null }), close())} />
                {ESTIMATES.map((n) => (
                  <Opt key={n} icon={<Gauge className="size-4" />} label={`${n} ${n === 1 ? "point" : "points"}`} active={estimate === n} onClick={() => (patch({ estimate: n }), close())} />
                ))}
              </>
            )}
          />

          {/* Cycle */}
          <Field
            label="Cycle"
            value={
              <span className="flex items-center gap-2">
                <IterationCcw className="size-3.5 text-muted-foreground" />
                {cycleLabel ?? "No cycle"}
              </span>
            }
            disabled={!editable}
            menu={(close) => (
              <>
                <Opt icon={<IterationCcw className="size-4" />} label="No cycle" active={cycleNumber == null} onClick={() => (patch({ cycleId: null }), close())} />
                {teamCycles.length === 0 && <div className="px-2.5 py-1.5 text-[12px] text-muted-foreground">No cycles</div>}
                {teamCycles.map((c) => (
                  <Opt key={c.id} icon={<IterationCcw className="size-4" />} label={c.name ?? `Cycle ${c.number ?? "?"}`} active={c.number != null && c.number === cycleNumber} onClick={() => (patch({ cycleId: c.id }), close())} />
                ))}
              </>
            )}
          />

          {/* Due date */}
          <div className="flex items-center gap-2 px-1.5 py-1.5 text-sm">
            <Calendar className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              type="date"
              value={dueDate ?? ""}
              disabled={!editable}
              onChange={(e) => patch({ dueDate: e.target.value || null })}
              className="bg-transparent text-sm text-foreground focus:outline-none disabled:opacity-70 [color-scheme:dark]"
            />
          </div>

          {/* Labels */}
          <RailSection title="Labels">
            <div className="flex flex-wrap items-center gap-1.5">
              {live?.labels.map((l) => (
                <span key={l.id} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-foreground">
                  <span className="size-2 rounded-full" style={{ backgroundColor: l.color ?? "#6b7280" }} />
                  {l.name}
                </span>
              ))}
              {(!live || live.labels.length === 0) && <span className="text-xs text-muted-foreground">None</span>}
              {editable && (
                <LabelPicker
                  all={labels ?? []}
                  selected={live?.labels.map((l) => l.id) ?? []}
                  onToggle={(labelId) => {
                    const ids = live?.labels.map((l) => l.id) ?? [];
                    const next = ids.includes(labelId) ? ids.filter((x) => x !== labelId) : [...ids, labelId];
                    patch({ labelIds: next });
                  }}
                />
              )}
            </div>
          </RailSection>

          {/* Project */}
          <RailSection title="Project">
            <Field
              label=""
              value={
                <span className="flex items-center gap-2">
                  <Box className="size-3.5 text-muted-foreground" />
                  {projectName ?? "No project"}
                </span>
              }
              disabled={!editable}
              menu={(close) => (
                <>
                  <Opt icon={<Box className="size-4" />} label="No project" active={!projectId} onClick={() => (patch({ projectId: null }), close())} />
                  {(filterOpts?.projects ?? []).map((p) => (
                    <Opt key={p.id} icon={<Box className="size-4" />} label={p.name} active={p.id === projectId} onClick={() => (patch({ projectId: p.id }), close())} />
                  ))}
                </>
              )}
            />
          </RailSection>

          {/* Relations */}
          {live && (live.children.length > 0 || live.relations.length > 0) && (
            <RailSection title="Relations">
              <div className="flex flex-col gap-1">
                {live.children.map((c) => (
                  <button key={c.id} type="button" onClick={() => openIssue(c.id)} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent">
                    <StatusIcon type={c.stateType} color="#6b7280" />
                    <span className="shrink-0 text-muted-foreground">{c.identifier}</span>
                    <span className="truncate text-foreground">{c.title}</span>
                  </button>
                ))}
                {live.relations.map((r, idx) => (
                  <button key={idx} type="button" onClick={() => openIssue(r.issue.id)} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent">
                    <span className="shrink-0 text-muted-foreground">{r.type}</span>
                    <span className="shrink-0 text-muted-foreground">{r.issue.identifier}</span>
                    <span className="truncate text-foreground">{r.issue.title}</span>
                  </button>
                ))}
              </div>
            </RailSection>
          )}

          {/* Links / PRs summary */}
          {(linkCount > 0 || prCount > 0) && (
            <div className="mt-3 flex items-center gap-4 px-1.5 text-xs text-muted-foreground">
              {linkCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <Link2 className="size-3.5" />
                  {linkCount} {linkCount === 1 ? "link" : "links"}
                </span>
              )}
              {prCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <GitPullRequest className="size-3.5" />
                  {prCount} {prCount === 1 ? "PR" : "PRs"}
                </span>
              )}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}

/** A clickable property row that opens a dropdown menu (read-only when disabled). */
function Field({
  label,
  value,
  menu,
  disabled,
}: {
  label: string;
  value: ReactNode;
  menu: (close: () => void) => ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), setOpen(false));
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (disabled) {
    return <div className="flex items-center gap-2 px-1.5 py-1.5 text-sm text-foreground">{value}</div>;
  }
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        title={label}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
      >
        {value}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 max-h-72 w-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-2xl">
          {menu(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function Opt({ icon, label, active, onClick }: { icon: ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-accent"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {active && <Check className="size-3.5 shrink-0 text-primary" />}
    </button>
  );
}

function RailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <div className="mb-1.5 px-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function LabelPicker({ all, selected, onToggle }: { all: { id: string; name: string | null; color: string | null }[]; selected: string[]; onToggle: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), setOpen(false));
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        title="Add label"
        onClick={() => setOpen((o) => !o)}
        className="flex size-5 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Tag className="size-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-2xl">
          {all.length === 0 && <div className="px-2.5 py-1.5 text-[12px] text-muted-foreground">No labels</div>}
          {all.map((l) => (
            <Opt
              key={l.id}
              icon={<span className="size-2.5 rounded-full" style={{ backgroundColor: l.color ?? "#6b7280" }} />}
              label={l.name ?? "label"}
              active={selected.includes(l.id)}
              onClick={() => onToggle(l.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OverflowMenu({
  onCopyId,
  onCopyLink,
  onOpenLinear,
  onDelete,
}: {
  onCopyId: () => void;
  onCopyLink: () => void;
  onOpenLinear?: () => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), setOpen(false));
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const run = (fn: () => void) => () => (fn(), setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <IconBtn title="More" onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal className="size-4" />
      </IconBtn>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-52 rounded-lg border border-border bg-popover p-1 shadow-2xl">
          <Opt icon={<Copy className="size-4" />} label="Copy ID" onClick={run(onCopyId)} />
          <Opt icon={<Link2 className="size-4" />} label="Copy link" onClick={run(onCopyLink)} />
          {onOpenLinear && <Opt icon={<ExternalLink className="size-4" />} label="Open in Linear" onClick={run(onOpenLinear)} />}
          {onDelete && (
            <>
              <div className="my-1 border-t border-border/60" />
              <button
                type="button"
                onClick={run(onDelete)}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-red-400 transition-colors hover:bg-red-500/10"
              >
                <Trash2 className="size-4" />
                <span className="flex-1">Delete</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
