import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { safeExternalUrl } from "@/lib/links";
import { gooeyToast } from "goey-toast";
import {
  AlertCircle,
  Box,
  Check,
  ChevronDown,
  CircleDot,
  Copy,
  ExternalLink,
  Gauge,
  GitPullRequest,
  IterationCcw,
  Link2,
  Loader2,
  Maximize2,
  MoreHorizontal,
  SlidersHorizontal,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { StatusIcon, PRIORITIES } from "./issueGlyphs";
import type { SaveStatus } from "./descriptionAutosave";
import {
  useCreateComment,
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
import { IssueRow, compareIssues } from "@/features/issues/IssueRow";
import { DisplayOptions } from "@/features/issues/DisplayOptions";
import { DEFAULT_DISPLAY, type Ordering, type Completed, type DisplayKey, type DisplayProps } from "@/features/issues/viewConfig";
import { dhakaToday } from "@/lib/dates";
import { useWorkspace } from "@/lib/tabs";
import type { CalendarIssue, DetailAttachment, DetailRelation, IssueDetailResult, LiveDetail, UpdateIssuePatch } from "@/lib/commands";
import { AssigneeSelect } from "@/components/AssigneeSelect";
import { DatePicker } from "@/components/DatePicker";
import { Popover, PopoverItem } from "@/components/Popover";
import { buildActivity, mergeActivityTimeline } from "./drawerActivity";
import { buildCommentThreads } from "./comments/commentThreads";
import { CommentComposer } from "./comments/CommentComposer";
import { CommentThread } from "./comments/CommentThread";
import { DescriptionEditor } from "./DescriptionEditor";
import { createMarkdownComponents, mentionAwareUrlTransform, type MentionResolver } from "./markdownComponents";
import { timeAgo } from "./timeAgo";

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

const priorityDot = (value: number) => {
  const p = PRIORITIES.find((x) => x.value === value) ?? PRIORITIES[0];
  return <span className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />;
};

/** Group relations by type, preserving first-seen order (Blocking before Related, etc.). */
function groupRelations(relations: DetailRelation[]): [string, DetailRelation[]][] {
  const groups = new Map<string, DetailRelation[]>();
  for (const relation of relations) {
    const existing = groups.get(relation.type);
    if (existing) existing.push(relation);
    else groups.set(relation.type, [relation]);
  }
  return [...groups.entries()];
}

/** Humanize a Linear relation type ("blocks" → "Blocking") for a subgroup heading. */
function relationGroupLabel(type: string): string {
  switch (type) {
    case "blocks":
      return "Blocking";
    case "blocked_by":
    case "blockedBy":
      return "Blocked by";
    case "duplicate":
      return "Duplicate";
    case "related":
      return "Related";
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[data-drawer-resource-modal]")) onClose();
    };
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
        {result ? <IssueDetail id={id} result={result} mode="drawer" onClose={onClose} /> : null}
      </aside>
    </div>
  );
}

export function IssueDetail({ id, result, mode, onClose }: { id: string; result: IssueDetailResult; mode: "drawer" | "page"; onClose: () => void }) {
  const [, setParams] = useSearchParams();
  const update = useUpdateIssue();
  const del = useDeleteIssue();
  const createComment = useCreateComment();
  const [composerKey, setComposerKey] = useState(0);
  const users = useUsers();
  const { data: labels } = useLabels();
  const { data: cycles } = useCycles();
  const { data: filterOpts } = useFilterOptions();
  const { data: issues } = useIssues({});
  const { openMenu } = useIssueMenu();
  const { openIssueTab } = useWorkspace();

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
  const activity = useMemo(
    () => live
      ? buildActivity({
          createdAt: live.createdAt,
          creatorName: live.creatorName,
          history: live.history,
        })
      : [],
    [live],
  );

  const timeline = useMemo(
    () => mergeActivityTimeline(activity, live ? buildCommentThreads(live.comments) : []),
    [activity, live],
  );

  const detailTitle = d.title;
  const detailDesc = "description" in d ? d.description ?? "" : "";
  const [title, setTitle] = useState(detailTitle);
  const [expandedResource, setExpandedResource] = useState<DetailAttachment | null>(null);
  const [saveState, setSaveState] = useState<SaveStatus>("idle");
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // Fire a single error toast when the save state transitions into "error".
  const prevSaveStateRef = useRef<SaveStatus>("idle");
  useEffect(() => {
    if (saveState === "error" && prevSaveStateRef.current !== "error") {
      gooeyToast.error("Couldn't save description");
    }
    prevSaveStateRef.current = saveState;
  }, [saveState]);

  // Reset the save indicator when switching to a different issue (DrawerContent
  // is re-rendered, not re-mounted, on id change).
  useEffect(() => {
    setSaveState("idle");
    prevSaveStateRef.current = "idle";
  }, [id]);

  useEffect(() => {
    setTitle(detailTitle);
    setExpandedResource(null);
  }, [id, result.source, detailTitle]);

  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [title]);

  const patch = (p: UpdateIssuePatch) => update.mutate({ id, patch: p });
  const openIssue = useCallback((next: string) => setParams({ issue: next }), [setParams]);

  // Sub-issue display state (ordering / completed filter / display columns).
  const [subOrdering, setSubOrdering] = useState<Ordering>("priority");
  const [subCompleted, setSubCompleted] = useState<Completed>("all");
  const [subDisplay, setSubDisplay] = useState<DisplayProps>(() => ({
    ...DEFAULT_DISPLAY,
    id: false, created: false, updated: false,
  }));
  const toggleSubDisplay = (k: DisplayKey) => setSubDisplay((d) => ({ ...d, [k]: !d[k] }));

  // Map id -> cached IssueListItem for sub-issue row resolution.
  const issuesById = useMemo(
    () => new Map((issues ?? []).map((i) => [i.id, i])),
    [issues],
  );

  // Map identifier -> cached issue so Linear issue links/mentions resolve: they
  // open the in-app drawer (and render as highlighted pills); every other link
  // opens in the system browser (never the webview).
  const issueByIdent = useMemo(
    () => new Map((issues ?? []).map((i) => [i.identifier.toUpperCase(), i])),
    [issues],
  );

  const handleLink = useCallback(
    (href: string) => {
      const m = href.match(/\/issue\/([A-Za-z0-9]+-\d+)/);
      const target = m ? issueByIdent.get(m[1].toUpperCase()) : undefined;
      if (target) return openIssue(target.id);
      const external = safeExternalUrl(href);
      if (external) openUrl(external).catch(() => gooeyToast.error("Couldn't open the link"));
      else gooeyToast.error("Blocked unsafe link");
    },
    [issueByIdent, openIssue],
  );

  const resolveMention = useCallback<MentionResolver>(
    (identifier) => {
      const i = issueByIdent.get(identifier.toUpperCase());
      return i ? { identifier: i.identifier, title: i.title, stateType: i.stateType, stateColor: i.stateColor, stateName: i.stateName, projectName: i.projectName, priority: i.priority, assigneeName: i.assigneeName } : undefined;
    },
    [issueByIdent],
  );

  const md = useMemo<Components>(
    () => createMarkdownComponents({ onActivateLink: handleLink, resolveMention }),
    [handleLink, resolveMention],
  );

  const saveDescription = async (markdown: string) => {
    await update.mutateAsync({ id, patch: { description: markdown === "" ? null : markdown }, silent: true });
  };

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
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {saveState === "saving" && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Saving…
            </span>
          )}
          {saveState === "saved" && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="size-3" />
              Saved
            </span>
          )}
          {saveState === "error" && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="size-3" />
              Save failed
            </span>
          )}
          <div className="flex items-center gap-0.5">
          {mode === "drawer" && (
            <IconBtn title="Open in full page" onClick={() => { openIssueTab(id); onClose(); }}>
              <Maximize2 className="size-4" />
            </IconBtn>
          )}
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
          {mode === "drawer" && (
            <IconBtn title="Close" onClick={onClose}>
              <X className="size-4" />
            </IconBtn>
          )}
          </div>
        </div>
      </header>

      {result.source !== "live" && (
        <p className="border-b border-border bg-secondary/40 px-4 py-1.5 text-xs text-muted-foreground">
          {result.source === "preview" ? "Loading…" : "Offline — showing cached data. Editing is disabled."}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Main column */}
        <div className="drawer-scrollbar min-w-0 flex-1 overflow-y-auto">
          {/* Page mode centers the reading column (Linear-style full-page);
              drawer mode keeps the original padded full-width layout. */}
          <div className={mode === "page" ? "mx-auto max-w-3xl px-8 py-8" : "px-7 py-6"}>
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
            <DescriptionEditor
              key={id}
              markdown={detailDesc}
              editable={editable}
              onSave={saveDescription}
              onOpenLink={handleLink}
              resolveMention={resolveMention}
              onSaveStateChange={setSaveState}
              onSaveError={() => gooeyToast.error("Couldn't save description")}
            />
          </section>

          {live && live.children.length > 0 && (
            <DrawerSection
              title="Sub-issues"
              meta={`${live.children.filter((child) => child.stateType === "completed").length}/${live.children.length}`}
            >
              <div className="mb-1 flex justify-end">
                <Popover
                  align="end"
                  buttonTitle="Display options"
                  buttonClassName="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  button={<SlidersHorizontal className="size-3.5" />}
                  panelClassName="w-72 rounded-lg border border-border bg-popover p-3 shadow-2xl"
                >
                  {() => (
                    <div className="space-y-3">
                      <DisplayOptions
                        ordering={subOrdering}
                        onOrdering={setSubOrdering}
                        completed={subCompleted}
                        onCompleted={setSubCompleted}
                        display={subDisplay}
                        onToggleDisplay={toggleSubDisplay}
                      />
                    </div>
                  )}
                </Popover>
              </div>
              {(() => {
                const today = dhakaToday();
                const rows = live.children
                  .map((c) => issuesById.get(c.id))
                  .filter((i): i is NonNullable<typeof i> => !!i)
                  .filter((i) => (subCompleted === "active" ? i.stateType !== "completed" && i.stateType !== "canceled" : true))
                  .sort((a, b) => compareIssues(a, b, subOrdering));
                return (
                  <div>
                    {rows.map((sub) => (
                      <IssueRow
                        key={sub.id}
                        issue={sub}
                        display={subDisplay}
                        avatar={sub.assigneeName ? { name: sub.assigneeName } : null}
                        today={today}
                        onOpen={openIssue}
                        onContextMenu={(e) => openMenu(e, sub.id)}
                      />
                    ))}
                    {rows.length === 0 && (
                      <p className="px-2 py-1 text-xs text-muted-foreground">No sub-issues match the current filter.</p>
                    )}
                    {live.hasMoreChildren && <p className="px-2 pt-1 text-xs text-muted-foreground">Showing the first 50 sub-issues.</p>}
                  </div>
                );
              })()}
            </DrawerSection>
          )}


          {live && live.attachments.length > 0 && (
            <DrawerSection title="Resources">
              <div className="space-y-2">
                {live.attachments.map((attachment) => (
                  <div key={attachment.id} className="flex min-w-0 items-center rounded-xl border border-border bg-card transition-colors hover:border-foreground/20 hover:bg-accent">
                    <button
                      type="button"
                      onClick={() => setExpandedResource(attachment)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      {attachment.sourceType === "github" ? (
                        <GitPullRequest className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <Link2 className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{attachment.title}</span>
                      {attachment.subtitle && <span className="max-w-52 truncate text-xs text-muted-foreground">{attachment.subtitle}</span>}
                      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(attachment.createdAt)}</span>
                    </button>
                    <Popover
                      align="end"
                      buttonTitle="Resource actions"
                      buttonClassName="mr-2 flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      button={<MoreHorizontal className="size-4" />}
                      panelClassName="w-52 rounded-xl border border-border bg-popover p-1.5 shadow-2xl"
                    >
                      {(close) => (
                        <>
                          <PopoverItem icon={<Maximize2 className="size-4" />} label="Expand in Linear" onClick={() => (setExpandedResource(attachment), close())} />
                          <PopoverItem
                            icon={<ExternalLink className="size-4" />}
                            label="Open original"
                            onClick={() => {
                              close();
                              const external = safeExternalUrl(attachment.url);
                              if (external) openUrl(external).catch(() => gooeyToast.error("Couldn't open the resource"));
                              else gooeyToast.error("Blocked unsafe link");
                            }}
                          />
                        </>
                      )}
                    </Popover>
                  </div>
                ))}
                {live.attachmentsTruncated && <p className="px-2 pt-1 text-xs text-muted-foreground">Showing the first 50 resources.</p>}
              </div>
            </DrawerSection>
          )}

          {live && (
            <DrawerSection title="Activity" className="border-t border-border pt-6">
              <div className="space-y-4">
                <div className="space-y-3">
                  {timeline.map((entry) =>
                    entry.kind === "event" ? (
                      <div key={entry.key} className="flex gap-3">
                        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
                          {entry.event.kind === "created" ? <CircleDot className="size-3.5" /> : <IterationCcw className="size-3.5" />}
                        </span>
                        <p className="min-w-0 flex-1 pt-0.5 text-sm leading-5 text-muted-foreground">
                          <span className="font-medium text-foreground">{entry.event.actorName ?? "Linear"}</span>{" "}
                          {entry.event.summary} · {timeAgo(entry.event.createdAt)}
                        </p>
                      </div>
                    ) : (
                      <CommentThread key={entry.key} thread={entry.thread} issueId={id} onOpenLink={handleLink} resolveMention={resolveMention} />
                    ),
                  )}
                </div>
                {timeline.length === 0 && (
                  <p className="text-sm text-muted-foreground">No activity yet.</p>
                )}
                {(live.hasMoreHistory || live.hasMoreComments) && (
                  <p className="text-xs text-muted-foreground">Showing the first 50 history events and comments.</p>
                )}
                {editable && (
                  <div className="mt-4">
                    <CommentComposer
                      key={`composer-${id}-${composerKey}`}
                      variant="pinned"
                      submitting={createComment.isPending}
                      users={users.data ?? []}
                      onOpenLink={handleLink}
                      resolveMention={resolveMention}
                      onSubmit={(body) => createComment.mutate({ issueId: id, body }, { onSuccess: () => setComposerKey((k) => k + 1) })}
                    />
                  </div>
                )}
              </div>
            </DrawerSection>
          )}
          </div>
        </div>

        {/* Properties rail — right-click anywhere here for the full issue menu */}
        <aside
          className="drawer-scrollbar flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto p-3"
          onContextMenu={(e) => openMenu(e, id)}
        >
          <RailCard title="Properties">
            <Field
              icon={<StatusIcon type={stateType} color={stateColor} />}
              label={stateName}
              disabled={!editable}
              menu={(close) =>
                (live?.teamStates ?? []).map((s) => (
                  <PopoverItem key={s.id} icon={<StatusIcon type={s.type} color={s.color} />} label={s.name} active={s.id === live?.stateId} onClick={() => (patch({ stateId: s.id }), close())} />
                ))
              }
            />
            <Field
              icon={priorityDot(priority)}
              label={PRIORITIES.find((p) => p.value === priority)?.label ?? "No priority"}
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
              icon={<Gauge className="size-3.5 text-muted-foreground" />}
              label={estimate != null ? `${estimate} ${estimate === 1 ? "Point" : "Points"}` : "No estimate"}
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
              icon={<IterationCcw className="size-3.5 text-muted-foreground" />}
              label={cycleLabel ?? "No cycle"}
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
            <DatePicker value={dueDate} onChange={(v) => patch({ dueDate: v })} disabled={!editable} />

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
              icon={<Box className="size-3.5 text-muted-foreground" />}
              label={projectName ?? "No project"}
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

          {live && live.relations.length > 0 && (
            <RailCard title="Relations">
              <div className="flex flex-col gap-3 px-1.5 pb-1">
                {groupRelations(live.relations).map(([type, items]) => (
                  <div key={type} className="flex flex-col gap-0.5">
                    <span className="px-0.5 text-xs text-muted-foreground">{relationGroupLabel(type)}</span>
                    {items.map((relation, index) => (
                      <button
                        key={`${relation.issue.id}-${index}`}
                        type="button"
                        onClick={() => openIssue(relation.issue.id)}
                        title={`${relation.issue.identifier} ${relation.issue.title}`}
                        className="flex w-full min-w-0 items-center gap-2 rounded-md px-0.5 py-1 text-left text-sm text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="flex size-3.5 shrink-0 items-center justify-center">
                          {relation.issue.stateType ? (
                            <StatusIcon type={relation.issue.stateType} color={relation.issue.stateColor ?? ""} />
                          ) : (
                            <Link2 className="size-3.5 text-muted-foreground" />
                          )}
                        </span>
                        <span className="truncate">{relation.issue.title}</span>
                      </button>
                    ))}
                  </div>
                ))}
                {live.hasMoreRelations && <p className="px-0.5 pt-1 text-xs text-muted-foreground">Showing the first 50 relations.</p>}
              </div>
            </RailCard>
          )}

        </aside>
      </div>
      {expandedResource && (
        <ResourceModal
          attachment={expandedResource}
          markdownComponents={md}
          onClose={() => setExpandedResource(null)}
        />
      )}
    </>
  );
}

function ResourceModal({
  attachment,
  markdownComponents,
  onClose,
}: {
  attachment: DetailAttachment;
  markdownComponents: Components;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  const openOriginal = () => {
    const external = safeExternalUrl(attachment.url);
    if (external) openUrl(external).catch(() => gooeyToast.error("Couldn't open the resource"));
    else gooeyToast.error("Blocked unsafe link");
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      data-drawer-resource-modal
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="resource-modal-title" className="drawer-scrollbar flex max-h-[84vh] w-[min(760px,92vw)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="resource-modal-title" className="truncate text-base font-semibold text-foreground">{attachment.title}</h2>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{attachment.subtitle ?? attachment.sourceType ?? "Resource"}</p>
          </div>
          <IconBtn title="Open original" onClick={openOriginal}><ExternalLink className="size-4" /></IconBtn>
          <button ref={closeRef} type="button" aria-label="Close resource" onClick={onClose} className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" />
          </button>
        </header>
        <div className="drawer-scrollbar min-h-0 overflow-y-auto px-6 py-5">
          {attachment.body ? (
            <div className="astryn-prose prose prose-sm prose-invert max-w-none prose-headings:font-semibold prose-a:text-primary">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} urlTransform={mentionAwareUrlTransform}>{attachment.body}</ReactMarkdown>
            </div>
          ) : (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">This resource does not include expandable content.</p>
              <button type="button" onClick={openOriginal} className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Open original</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function DrawerSection({ title, meta, className = "", children }: { title: string; meta?: string; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`mt-8 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="mb-3 flex min-h-8 items-center gap-2 rounded-md text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
        {title}
        {meta && <span className="font-normal tabular-nums text-muted-foreground">{meta}</span>}
      </button>
      {open && children}
    </section>
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
function Field({ icon, label, menu, disabled }: { icon: ReactNode; label: ReactNode; menu: (close: () => void) => ReactNode; disabled?: boolean }) {
  // Fixed-width, centered icon slot so every row's label starts at the same x
  // regardless of the leading icon's intrinsic size (e.g. the 10px priority dot
  // vs the 14px status icon) — keeps the rail's labels in one clean column.
  const content = (
    <>
      <span className="flex size-3.5 shrink-0 items-center justify-center">{icon}</span>
      <span className="truncate">{label}</span>
    </>
  );
  if (disabled) {
    return <div className="flex min-w-0 items-center gap-2 px-1.5 py-1.5 text-sm text-foreground">{content}</div>;
  }
  return (
    <Popover
      align="end"
      buttonClassName="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
      button={<span className="flex min-w-0 items-center gap-2">{content}</span>}
    >
      {menu}
    </Popover>
  );
}
