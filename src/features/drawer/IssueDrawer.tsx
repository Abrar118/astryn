import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { safeExternalUrl } from "@/lib/links";
import { gooeyToast } from "goey-toast";
import {
  Box,
  ChevronDown,
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
  useIssues,
  useLabels,
  useUpdateIssue,
  useUsers,
} from "@/lib/queries";
import { useIssueMenu } from "@/features/issues/IssueContextMenu";
import type { CalendarIssue, IssueDetailResult, LiveDetail, UpdateIssuePatch } from "@/lib/commands";
import { AssigneeSelect } from "@/components/AssigneeSelect";
import { Avatar } from "@/components/Avatar";
import { DatePicker } from "@/components/DatePicker";
import { Popover, PopoverItem } from "@/components/Popover";

const PRIORITIES = [
  { value: 0, label: "No priority", color: "#6b7280" },
  { value: 1, label: "Urgent", color: "#ef4444" },
  { value: 2, label: "High", color: "#f97316" },
  { value: 3, label: "Medium", color: "#eab308" },
  { value: 4, label: "Low", color: "#3b82f6" },
];
const ESTIMATES = [0, 1, 2, 3, 5, 8];

const WIDTH_KEY = "astryn.drawer-width";
const DEFAULT_WIDTH = 920;
const MIN_WIDTH = 480;

function loadWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    return v >= MIN_WIDTH ? v : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

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

const priorityDot = (value: number) => {
  const p = PRIORITIES.find((x) => x.value === value) ?? PRIORITIES[0];
  return <span className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />;
};

export function IssueDrawer() {
  const [params, setParams] = useSearchParams();
  const id = params.get("issue");
  const [shownId, setShownId] = useState<string | null>(id);
  const [open, setOpen] = useState(false);

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
  const [width, setWidth] = useState(loadWidth);
  const widthRef = useRef(width);
  widthRef.current = width;
  const resizing = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!resizing.current) return;
      setWidth(Math.max(MIN_WIDTH, Math.min(window.innerWidth * 0.96, window.innerWidth - e.clientX)));
    };
    const onUp = () => {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(WIDTH_KEY, String(Math.round(widthRef.current)));
      } catch {
        /* storage unavailable */
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    resizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div className="fixed inset-0 z-30" data-command-shortcut-blocker>
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 motion-reduce:transition-none ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <aside
        style={{ width }}
        className={`absolute right-0 top-0 flex h-full max-w-[96vw] flex-col border-l border-border bg-background shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div
          onPointerDown={startResize}
          title="Drag to resize"
          className="absolute left-0 top-0 z-20 h-full w-1.5 cursor-col-resize transition-colors hover:bg-primary/40"
        />
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
  const { data: issues } = useIssues({});
  const { openMenu } = useIssueMenu();

  const live = result.source === "live" ? (result.detail as LiveDetail) : null;
  const editable = result.source === "live";
  const d = result.detail;

  // Fields shared by all branches (CalendarIssue | Issue | LiveDetail).
  const identifier = d.identifier;
  const priority = d.priority;
  const dueDate = d.dueDate;
  const projectId = d.projectId;
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

  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [title]);

  const patch = (p: UpdateIssuePatch) => update.mutate({ id, patch: p });
  const openIssue = (next: string) => setParams({ issue: next });

  // Map identifier -> id so Linear issue links in markdown open the in-app
  // drawer; every other link opens in the system browser (never the webview).
  const identMap = useMemo(() => new Map((issues ?? []).map((i) => [i.identifier.toUpperCase(), i.id])), [issues]);
  const md = useMemo<Components>(
    () => ({
      a: ({ href, children }) => (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            if (!href) return;
            const m = href.match(/\/issue\/([A-Za-z0-9]+-\d+)/);
            const target = m ? identMap.get(m[1].toUpperCase()) : undefined;
            if (target) openIssue(target);
            else {
              const external = safeExternalUrl(href);
              if (external) openUrl(external).catch(() => gooeyToast.error("Couldn't open the link"));
              else gooeyToast.error("Blocked unsafe link");
            }
          }}
          className="cursor-pointer text-primary hover:underline"
        >
          {children}
        </a>
      ),
    }),
    // openIssue is stable enough for the drawer's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [identMap],
  );

  const teamCycles = useMemo(
    () => (cycles ?? []).filter((c) => c.teamId === d.teamId).sort((a, b) => (b.number ?? 0) - (a.number ?? 0)),
    [cycles, d.teamId],
  );

  const stateColor = "stateColor" in d ? d.stateColor : "#6b7280";
  const stateType = d.stateType;
  const stateName = "stateName" in d ? d.stateName ?? stateType : stateType;
  const cycleLabel = cycleName ?? (cycleNumber != null ? `Cycle ${cycleNumber}` : null);
  const openLinear = url ? () => openUrl(url).catch(() => gooeyToast.error("Couldn't open the link")) : undefined;

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
          {openLinear && (
            <IconBtn title="Open in Linear" onClick={openLinear}>
              <ExternalLink className="size-4" />
            </IconBtn>
          )}
          <Popover
            align="end"
            buttonTitle="More"
            buttonClassName="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            button={<MoreHorizontal className="size-4" />}
            panelClassName="w-52 rounded-lg border border-border bg-popover p-1 shadow-2xl"
          >
            {(close) => (
              <>
                <PopoverItem icon={<Copy className="size-4" />} label="Copy ID" onClick={() => (copyText(identifier, "ID"), close())} />
                <PopoverItem icon={<Link2 className="size-4" />} label="Copy link" onClick={() => (copyText(url ?? identifier, "Link"), close())} />
                {openLinear && <PopoverItem icon={<ExternalLink className="size-4" />} label="Open in Linear" onClick={() => (openLinear(), close())} />}
                {editable && (
                  <>
                    <div className="my-1 border-t border-border/60" />
                    <PopoverItem
                      icon={<Trash2 className="size-4" />}
                      label="Delete"
                      danger
                      onClick={() => {
                        close();
                        del.mutate(id, { onSuccess: onClose });
                      }}
                    />
                  </>
                )}
              </>
            )}
          </Popover>
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
            className="w-full resize-none bg-transparent text-2xl font-semibold leading-snug text-foreground focus:outline-none disabled:opacity-100"
          />

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
                className="min-h-48 w-full resize-y rounded-md border border-border bg-card p-3 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : (
              <div className="prose prose-sm prose-invert max-w-none prose-headings:font-semibold prose-a:text-primary">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>
                  {desc || "_No description_"}
                </ReactMarkdown>
              </div>
            )}
          </section>

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
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>
                            {c.body}
                          </ReactMarkdown>
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

        {/* Properties rail — right-click anywhere here for the full issue menu */}
        <aside
          className="flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto p-3"
          onContextMenu={(e) => openMenu(e, id)}
        >
          <RailCard title="Properties">
            <Field
              value={
                <>
                  <StatusIcon type={stateType} color={stateColor} />
                  {stateName}
                </>
              }
              disabled={!editable}
              menu={(close) =>
                (live?.teamStates ?? []).map((s) => (
                  <PopoverItem key={s.id} icon={<StatusIcon type={s.type} color={s.color} />} label={s.name} active={s.id === live?.stateId} onClick={() => (patch({ stateId: s.id }), close())} />
                ))
              }
            />
            <Field
              value={
                <>
                  {priorityDot(priority)}
                  {PRIORITIES.find((p) => p.value === priority)?.label ?? "No priority"}
                </>
              }
              disabled={!editable}
              menu={(close) =>
                PRIORITIES.map((p) => (
                  <PopoverItem key={p.value} icon={<span className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />} label={p.label} active={p.value === priority} onClick={() => (patch({ priority: p.value }), close())} />
                ))
              }
            />
            <div className="px-1.5 py-1">
              <AssigneeSelect value={d.assigneeId ?? null} onChange={(uid) => patch({ assigneeId: uid })} users={users.data ?? []} emptyLabel="Unassigned" disabled={!editable} />
            </div>
            <Field
              value={
                <>
                  <Gauge className="size-3.5 text-muted-foreground" />
                  {estimate != null ? `${estimate} ${estimate === 1 ? "Point" : "Points"}` : "No estimate"}
                </>
              }
              disabled={!editable}
              menu={(close) => (
                <>
                  <PopoverItem icon={<Gauge className="size-4" />} label="No estimate" active={estimate == null} onClick={() => (patch({ estimate: null }), close())} />
                  {ESTIMATES.map((n) => (
                    <PopoverItem key={n} icon={<Gauge className="size-4" />} label={`${n} ${n === 1 ? "point" : "points"}`} active={estimate === n} onClick={() => (patch({ estimate: n }), close())} />
                  ))}
                </>
              )}
            />
            <Field
              value={
                <>
                  <IterationCcw className="size-3.5 text-muted-foreground" />
                  {cycleLabel ?? "No cycle"}
                </>
              }
              disabled={!editable}
              menu={(close) => (
                <>
                  <PopoverItem icon={<IterationCcw className="size-4" />} label="No cycle" active={cycleNumber == null} onClick={() => (patch({ cycleId: null }), close())} />
                  {teamCycles.length === 0 && <div className="px-2.5 py-1.5 text-[12px] text-muted-foreground">No cycles</div>}
                  {teamCycles.map((c) => (
                    <PopoverItem key={c.id} icon={<IterationCcw className="size-4" />} label={c.name ?? `Cycle ${c.number ?? "?"}`} active={c.number != null && c.number === cycleNumber} onClick={() => (patch({ cycleId: c.id }), close())} />
                  ))}
                </>
              )}
            />
            <div className="px-1.5">
              <DatePicker value={dueDate} onChange={(v) => patch({ dueDate: v })} disabled={!editable} />
            </div>
          </RailCard>

          <RailCard
            title="Labels"
            action={
              editable ? (
                <Popover
                  align="end"
                  buttonTitle="Add label"
                  buttonClassName="flex size-5 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  button={<Tag className="size-3" />}
                  panelClassName="max-h-72 w-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-2xl"
                >
                  {() => (
                    <>
                      {(labels ?? []).length === 0 && <div className="px-2.5 py-1.5 text-[12px] text-muted-foreground">No labels</div>}
                      {(labels ?? []).map((l) => {
                        const has = live?.labels.some((x) => x.id === l.id) ?? false;
                        return (
                          <PopoverItem
                            key={l.id}
                            icon={<span className="size-2.5 rounded-full" style={{ backgroundColor: l.color ?? "#6b7280" }} />}
                            label={l.name ?? "label"}
                            active={has}
                            onClick={() => {
                              const ids = live?.labels.map((x) => x.id) ?? [];
                              patch({ labelIds: has ? ids.filter((x) => x !== l.id) : [...ids, l.id] });
                            }}
                          />
                        );
                      })}
                    </>
                  )}
                </Popover>
              ) : undefined
            }
          >
            <div className="flex flex-wrap items-center gap-1.5 px-1.5">
              {live?.labels.map((l) => (
                <span key={l.id} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-foreground">
                  <span className="size-2 rounded-full" style={{ backgroundColor: l.color ?? "#6b7280" }} />
                  {l.name}
                </span>
              ))}
              {(!live || live.labels.length === 0) && <span className="text-xs text-muted-foreground">None</span>}
            </div>
          </RailCard>

          <RailCard title="Project">
            <Field
              value={
                <>
                  <Box className="size-3.5 text-muted-foreground" />
                  {projectName ?? "No project"}
                </>
              }
              disabled={!editable}
              menu={(close) => (
                <>
                  <PopoverItem icon={<Box className="size-4" />} label="No project" active={!projectId} onClick={() => (patch({ projectId: null }), close())} />
                  {(filterOpts?.projects ?? []).map((p) => (
                    <PopoverItem key={p.id} icon={<Box className="size-4" />} label={p.name} active={p.id === projectId} onClick={() => (patch({ projectId: p.id }), close())} />
                  ))}
                </>
              )}
            />
          </RailCard>

          {live && (live.children.length > 0 || live.relations.length > 0) && (
            <RailCard title="Relations">
              <div className="flex flex-col gap-0.5">
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
            </RailCard>
          )}

          {(linkCount > 0 || prCount > 0) && (
            <div className="flex items-center gap-4 px-3 text-xs text-muted-foreground">
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
    <button type="button" title={title} onClick={onClick} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
      {children}
    </button>
  );
}

/** A collapsible card grouping rail properties (Properties / Labels / etc.). */
function RailCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center px-3 py-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
          <ChevronDown className={`size-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
        </button>
        {action && <span onClick={(e) => e.stopPropagation()}>{action}</span>}
      </div>
      {open && <div className="px-1.5 pb-2">{children}</div>}
    </div>
  );
}

/** A clickable property row that opens a portal dropdown (read-only when disabled). */
function Field({ value, menu, disabled }: { value: ReactNode; menu: (close: () => void) => ReactNode; disabled?: boolean }) {
  if (disabled) {
    return <div className="flex items-center gap-2 px-1.5 py-1.5 text-sm text-foreground">{value}</div>;
  }
  return (
    <Popover
      align="end"
      buttonClassName="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
      button={<span className="flex items-center gap-2">{value}</span>}
    >
      {menu}
    </Popover>
  );
}
