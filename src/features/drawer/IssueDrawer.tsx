import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { safeExternalUrl } from "@/lib/links";
import { gooeyToast } from "goey-toast";
import {
  Box,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Copy,
  ExternalLink,
  FileText,
  Gauge,
  GitBranch,
  GitPullRequest,
  IterationCcw,
  Link2,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  User,
  X,
} from "lucide-react";
import { StatusIcon, PRIORITIES } from "./issueGlyphs";
import { attachDocumentsToIssue } from "./attachUpload";
import type { SaveStatus } from "./descriptionAutosave";
import {
  useCreateComment,
  useCreateLabel,
  useCycles,
  useDeleteAttachment,
  useFilterOptions,
  useIssues,
  useLabels,
  useUpdateAttachment,
  useUsers,
} from "@/lib/queries";
import { useDeleteTask, useUpdateTask } from "@/lib/taskQueries";
import { useIssueMenu } from "@/features/issues/IssueContextMenu";
import { IssueRow, PriorityIcon, compareIssues } from "@/features/issues/IssueRow";
import { Button } from "@/components/ui/button";
import { IndicatorLamp } from "@/components/IndicatorLamp";
import { DisplayOptions } from "@/features/issues/DisplayOptions";
import { type Ordering, type Completed, type DisplayKey, type DisplayProps } from "@/features/issues/viewConfig";
import { loadSubIssueDisplay, saveSubIssueDisplay, type SubIssueDisplay } from "./subIssueDisplay";
import { dhakaToday } from "@/lib/dates";
import { useWorkspace } from "@/lib/tabs";
import type { DetailAttachment, DetailChild, DetailRelation, IssueDetailResult, Label, LiveDetail, UpdateIssuePatch, User as LinearUser } from "@/lib/commands";
import { Avatar } from "@/components/Avatar";
import { AssigneeSelect } from "@/components/AssigneeSelect";
import { DatePicker } from "@/components/DatePicker";
import { Popover, PopoverItem } from "@/components/Popover";
import { pickLabelColor } from "./labelColors";
import { buildActivity, mergeActivityTimeline, type ActivityItem } from "./drawerActivity";
import { buildCommentThreads } from "./comments/commentThreads";
import { CommentComposer } from "./comments/CommentComposer";
import { CommentThread } from "./comments/CommentThread";
import { DescriptionEditor, makeUserResolver } from "./DescriptionEditor";
import { createMarkdownComponents, mentionAwareUrlTransform, type MentionResolver } from "./markdownComponents";
import { timeAgo } from "./timeAgo";
import { createUserMentionRemarkPlugin } from "./remarkUserMentions";

const ESTIMATES = [0, 1, 2, 3, 5, 8];

/** A property value in the rail: a borderless row that hovers to the accent fill. */
const FIELD_ROW =
  "dash-control flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent";
/** A transient menu panel: the only surfaces in the panel that lift. */
const MENU_PANEL = "issues-overlay rounded-lg border border-border bg-popover p-1";
const INPUT =
  "w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring dark:bg-input/30";

function LabelDropdown({
  allLabels,
  appliedIds,
  teamId,
  onToggle,
  onCreated,
}: {
  allLabels: Label[];
  appliedIds: Set<string>;
  teamId: string | null;
  onToggle: (id: string) => void;
  onCreated: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const createLabelMut = useCreateLabel();
  const q = query.trim().toLowerCase();
  const filtered = q ? allLabels.filter((l) => (l.name ?? "").toLowerCase().includes(q)) : allLabels;
  const exact = allLabels.some((l) => (l.name ?? "").toLowerCase() === q);

  const create = () => {
    const name = query.trim();
    if (!name) return;
    createLabelMut.mutate(
      { name, teamId, color: pickLabelColor(allLabels) },
      { onSuccess: (lbl) => { onCreated(lbl.id); setQuery(""); } },
    );
  };

  return (
    <div className="w-64">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Change or add labels…"
        aria-label="Find or create a label"
        className={`mb-1 ${INPUT}`}
      />
      <div className="drawer-scrollbar max-h-64 overflow-y-auto">
        {filtered.map((l) => (
          <button key={l.id} type="button" aria-pressed={appliedIds.has(l.id)} onClick={() => onToggle(l.id)}
            className="dash-control flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-accent">
            <span className={`flex size-3.5 items-center justify-center rounded-[4px] border ${appliedIds.has(l.id) ? "border-primary bg-primary text-primary-foreground" : "border-input"}`}>
              {appliedIds.has(l.id) && <Check className="size-2.5" />}
            </span>
            <span className="size-2 rounded-full" style={{ backgroundColor: l.color ?? "var(--muted-foreground)" }} />
            <span className="flex-1 truncate">{l.name ?? "label"}</span>
          </button>
        ))}
        {q && !exact && (
          <button type="button" onClick={create} disabled={createLabelMut.isPending}
            className="dash-control flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-accent disabled:opacity-60">
            <Plus className="size-3.5 text-muted-foreground" />
            <span>Create label "{query.trim()}"</span>
          </button>
        )}
        {filtered.length === 0 && !q && <div className="px-2 py-1.5 text-[12px] text-muted-foreground">No labels</div>}
      </div>
    </div>
  );
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

/**
 * A resource's icon: the site's favicon (allowlisted host loaded directly per
 * the CSP), falling back to a brand/link glyph on error or an unparseable URL.
 */
function ResourceIcon({ url, sourceType }: { url: string; sourceType: string | null }) {
  const [failed, setFailed] = useState(false);
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* leave host empty → fall through to the glyph */
  }
  const Glyph = sourceType === "github" ? GitPullRequest : Link2;
  if (!host || failed) {
    return <Glyph className="size-4 shrink-0 text-muted-foreground" />;
  }
  return (
    <img
      src={`https://icons.duckduckgo.com/ip3/${host}.ico`}
      alt=""
      aria-hidden
      width={16}
      height={16}
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-4 shrink-0 rounded-sm"
    />
  );
}

/**
 * The "…" menu for a resource: Expand / Open, plus (when editable) inline Edit
 * (rename) and a two-click Remove. Lives in the Popover render-prop, holding its
 * own mode/confirm state so the menu can swap to a rename field in place.
 */
function ResourceActionsMenu({
  attachment,
  issueId,
  editable,
  close,
  onExpand,
  onOpenOriginal,
}: {
  attachment: DetailAttachment;
  issueId: string;
  editable: boolean;
  close: () => void;
  onExpand: () => void;
  onOpenOriginal: () => void;
}) {
  const updateAtt = useUpdateAttachment();
  const deleteAtt = useDeleteAttachment();
  const [mode, setMode] = useState<"menu" | "edit">("menu");
  const [title, setTitle] = useState(attachment.title);
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (mode === "edit") {
    const save = () => {
      const t = title.trim();
      if (!t) return;
      updateAtt.mutate({ issueId, id: attachment.id, title: t });
      close();
    };
    return (
      <div className="p-1">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setMode("menu");
          }}
          placeholder="Title"
          aria-label="Resource title"
          className={`mb-2 ${INPUT}`}
        />
        <div className="flex justify-end gap-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={() => setMode("menu")}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={!title.trim()}>
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <PopoverItem icon={<Maximize2 className="size-4" />} label="Expand in Linear" onClick={onExpand} />
      <PopoverItem icon={<ExternalLink className="size-4" />} label="Open original" onClick={onOpenOriginal} />
      {editable && (
        <>
          <div className="my-1 border-t border-border/60" />
          <PopoverItem icon={<Pencil className="size-4" />} label="Edit" onClick={() => { setTitle(attachment.title); setMode("edit"); }} />
          <PopoverItem
            icon={<Trash2 className="size-4" />}
            label={confirmRemove ? "Confirm remove" : "Remove"}
            danger
            onClick={() => {
              if (!confirmRemove) {
                setConfirmRemove(true);
                return;
              }
              deleteAtt.mutate({ issueId, id: attachment.id });
              close();
            }}
          />
        </>
      )}
    </>
  );
}

function FallbackChildRow({
  child,
  onOpen,
  onContextMenu,
}: {
  child: DetailChild;
  onOpen: (id: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onClick={() => onOpen(child.id)}
      onContextMenu={onContextMenu}
      className="issue-row group flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent"
    >
      <StatusIcon type={child.stateType} color={child.stateColor} />
      <span className="w-[4.5rem] shrink-0 font-mono text-xs text-muted-foreground">{child.identifier}</span>
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{child.title}</span>
      <div className="flex shrink-0 items-center gap-3 text-[12px] tabular-nums text-muted-foreground">
        {child.priority > 0 && <PriorityIcon p={child.priority} />}
        {child.dueDate && (
          <span className="flex items-center gap-1">
            <CalendarDays className="size-3" />
            {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "Asia/Dhaka" }).format(new Date(`${child.dueDate}T00:00:00Z`))}
          </span>
        )}
        {child.assigneeName && <Avatar name={child.assigneeName} size={20} />}
      </div>
    </div>
  );
}

function eventIcon(event: ActivityItem): ReactNode {
  if (event.kind === "created") return <CircleDot className="size-4 text-muted-foreground" />;
  switch (event.category) {
    case "status":
      return event.toStateType
        ? <StatusIcon type={event.toStateType} color={event.toStateColor ?? ""} />
        : <IterationCcw className="size-3.5 text-muted-foreground" />;
    case "assignee":
      return event.toAssigneeName
        ? <Avatar name={event.toAssigneeName} size={20} />
        : <User className="size-3.5 text-muted-foreground" />;
    case "priority":
      return <PriorityIcon p={event.toPriority ?? 0} />;
    case "title": return <Pencil className="size-3.5 text-muted-foreground" />;
    case "description": return <FileText className="size-3.5 text-muted-foreground" />;
    case "relation": return <Link2 className="size-3.5 text-muted-foreground" />;
    case "attachment": return <Paperclip className="size-3.5 text-muted-foreground" />;
    default: return <IterationCcw className="size-3.5 text-muted-foreground" />;
  }
}

export function IssueDetail({
  id,
  result,
  mode,
  onClose,
  docLinks,
}: {
  id: string;
  result: IssueDetailResult;
  mode: "drawer" | "page";
  onClose: () => void;
  /** App-owned F9 doc links (built by `TaskDetail`), placed after Resources. */
  docLinks?: ReactNode;
}) {
  const [, setParams] = useSearchParams();
  const update = useUpdateTask();
  const del = useDeleteTask();
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

  const qc = useQueryClient();
  const [attaching, setAttaching] = useState(false);
  const attachDocuments = async () => {
    if (attaching) return;
    setAttaching(true);
    try {
      await attachDocumentsToIssue(id, qc);
    } finally {
      setAttaching(false);
    }
  };

  // Fields shared by all branches (CalendarIssue | Issue | LiveDetail).
  const identifier = d.identifier;
  const priority = d.priority;
  const dueDate = d.dueDate;
  const projectId = d.projectId;
  const url = "url" in d ? d.url : null;
  const projectName = "projectName" in d ? d.projectName : null;
  const branchName = "branchName" in d ? d.branchName : null;
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

  // Grow the title field to its content, and again whenever the column width
  // changes (a narrower pane wraps the title onto more lines).
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    // Watch the column, not the field, so resizing the field never re-triggers itself.
    const ro = new ResizeObserver(fit);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [title]);

  const patch = (p: UpdateIssuePatch) => update.mutate({ id, patch: p });
  const openIssue = useCallback((next: string) => setParams({ issue: next }), [setParams]);

  // Sub-issue display state (ordering / completed filter / display columns),
  // loaded from + persisted to localStorage so funnel choices survive reopens.
  const subInit = useRef<SubIssueDisplay | null>(null);
  if (!subInit.current) subInit.current = loadSubIssueDisplay();
  const [subOrdering, setSubOrdering] = useState<Ordering>(subInit.current.ordering);
  const [subCompleted, setSubCompleted] = useState<Completed>(subInit.current.completed);
  const [subDisplay, setSubDisplay] = useState<DisplayProps>(subInit.current.display);
  const toggleSubDisplay = (k: DisplayKey) => setSubDisplay((d) => ({ ...d, [k]: !d[k] }));
  useEffect(() => {
    saveSubIssueDisplay({ ordering: subOrdering, completed: subCompleted, display: subDisplay });
  }, [subOrdering, subCompleted, subDisplay]);

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
    () =>
      createMarkdownComponents({
        onActivateLink: handleLink,
        resolveMention,
        resolveUser: makeUserResolver(users.data ?? []),
      }),
    [handleLink, resolveMention, users.data],
  );

  const saveDescription = async (markdown: string) => {
    await update.mutateAsync({ id, patch: { description: markdown === "" ? null : markdown }, silent: true });
  };

  const teamCycles = useMemo(
    () => (cycles ?? []).filter((c) => c.teamId === d.teamId).sort((a, b) => (b.number ?? 0) - (a.number ?? 0)),
    [cycles, d.teamId],
  );

  const stateColor = "stateColor" in d ? d.stateColor : "var(--muted-foreground)";
  const stateType = d.stateType;
  const stateName = "stateName" in d ? d.stateName ?? stateType : stateType;
  const cycleLabel = cycleName ?? (cycleNumber != null ? `Cycle ${cycleNumber}` : null);
  const openLinear = url ? () => openUrl(url).catch(() => gooeyToast.error("Couldn't open the link")) : undefined;

  return (
    <>
      {/* Breadcrumb / action header */}
      <header className="flex min-h-12 items-center gap-2 border-b border-border px-4 py-2 text-[13px]">
        <Box className="size-4 shrink-0 text-muted-foreground" />
        <span className="max-w-[12rem] shrink-0 truncate text-muted-foreground">{projectName ?? d.teamKey ?? "Issue"}</span>
        <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-mono text-xs font-medium text-foreground">{identifier}</span>
        <span className="min-w-0 truncate text-muted-foreground">{detailTitle}</span>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {/* Description autosave, reported on a lamp: unlit while saving, lit once saved. */}
          <span role="status" aria-live="polite" className="flex items-center gap-1.5 text-[12px]">
            {saveState === "saving" && (
              <>
                <IndicatorLamp tone="off" />
                <span className="text-muted-foreground">saving…</span>
              </>
            )}
            {saveState === "saved" && (
              <>
                <IndicatorLamp tone="success" />
                <span className="text-muted-foreground">saved</span>
              </>
            )}
            {saveState === "error" && (
              <>
                <IndicatorLamp tone="danger" />
                <span className="text-destructive">save failed</span>
              </>
            )}
          </span>
          <div className="flex items-center gap-0.5">
          {mode === "drawer" && (
            <IconBtn title="Open in full page" onClick={() => { openIssueTab(id); onClose(); }}>
              <Maximize2 className="size-4" />
            </IconBtn>
          )}
          {branchName && (
            <IconBtn title="Copy git branch name" onClick={() => copyText(branchName, "Branch name")}>
              <GitBranch className="size-4" />
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
            buttonClassName={ICON_BUTTON}
            button={<MoreHorizontal className="size-4" />}
            panelClassName={`w-52 ${MENU_PANEL}`}
          >
            {(close) => (
              <>
                <PopoverItem icon={<Copy className="size-4" />} label="Copy ID" onClick={() => (copyText(identifier, "ID"), close())} />
                <PopoverItem icon={<Link2 className="size-4" />} label="Copy link" onClick={() => (copyText(url ?? identifier, "Link"), close())} />
                {branchName && <PopoverItem icon={<GitBranch className="size-4" />} label="Copy git branch name" onClick={() => (copyText(branchName, "Branch name"), close())} />}
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
        <p role="status" className="flex items-center gap-2 border-b border-border px-4 py-2 text-[12px] text-muted-foreground">
          <IndicatorLamp tone={result.source === "preview" ? "off" : "warning"} />
          {result.source === "preview" ? "Loading…" : "Offline: showing cached data. Editing is disabled."}
        </p>
      )}

      <div className="@container flex min-h-0 flex-1">
        {/* Main column (pb clears the floating dock that overlaps the bottom) */}
        <div className="drawer-scrollbar min-w-0 flex-1 overflow-y-auto pb-24">
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
            aria-label="Issue title"
            className="w-full resize-none overflow-hidden bg-transparent text-[22px] font-semibold leading-snug tracking-tight text-foreground focus:outline-none disabled:opacity-100"
          />

          {live?.parent && (
            <button
              type="button"
              onClick={() => openIssue(live.parent!.id)}
              className="dash-control -mx-1.5 mt-1 flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <span className="shrink-0">Sub-issue of</span>
              <span className="shrink-0 font-mono text-xs font-medium text-foreground">{live.parent.identifier}</span>
              <span className="truncate">{live.parent.title}</span>
            </button>
          )}

          <section className="mt-5">
            <DescriptionEditor
              key={id}
              markdown={detailDesc}
              editable={editable}
              onSave={saveDescription}
              onOpenLink={handleLink}
              resolveMention={resolveMention}
              users={users.data ?? []}
              onSaveStateChange={setSaveState}
              onSaveError={() => gooeyToast.error("Couldn't save description")}
            />
          </section>

          {live && live.children.length > 0 && (
            <DrawerSection
              title="Sub-issues"
              meta={`${live.children.filter((child) => child.stateType === "completed").length}/${live.children.length}`}
              aside={
                <Popover
                  align="end"
                  buttonTitle="Display options"
                  buttonClassName={ICON_BUTTON}
                  button={<SlidersHorizontal className="size-3.5" />}
                  panelClassName="issues-overlay w-72 rounded-lg border border-border bg-popover p-3"
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
              }
            >
              {(() => {
                const today = dhakaToday();
                const entries = live.children
                  .map((child) => ({ child, cached: issuesById.get(child.id) ?? null }))
                  .filter(({ child, cached }) => {
                    const stateType = cached?.stateType ?? child.stateType;
                    return subCompleted === "active" ? stateType !== "completed" && stateType !== "canceled" : true;
                  });
                const cachedEntries = entries
                  .filter((e) => e.cached !== null)
                  .sort((a, b) => compareIssues(a.cached!, b.cached!, subOrdering));
                const uncachedEntries = entries.filter((e) => e.cached === null);
                const ordered = [...cachedEntries, ...uncachedEntries];
                return (
                  <div className="drawer-scrollbar -mx-4 overflow-x-auto border-y border-border">
                    {ordered.map(({ child, cached }) =>
                      cached ? (
                        <IssueRow
                          key={cached.id}
                          issue={cached}
                          display={subDisplay}
                          avatar={cached.assigneeName ? { name: cached.assigneeName } : null}
                          today={today}
                          onOpen={openIssue}
                          onContextMenu={(e) => openMenu(e, cached.id)}
                        />
                      ) : (
                        <FallbackChildRow
                          key={child.id}
                          child={child}
                          onOpen={openIssue}
                          onContextMenu={(e) => openMenu(e, child.id)}
                        />
                      )
                    )}
                    {ordered.length === 0 && (
                      <p className="px-4 py-2.5 text-[12px] text-muted-foreground">No sub-issues match the current filter.</p>
                    )}
                    {live.hasMoreChildren && (
                      <p className="border-t border-border px-4 py-2 text-[12px] text-muted-foreground">Showing the first 50 sub-issues.</p>
                    )}
                  </div>
                );
              })()}
            </DrawerSection>
          )}


          {live && (live.attachments.length > 0 || editable) && (
            <DrawerSection
              title="Resources"
              meta={live.attachments.length > 0 ? `${live.attachments.length}${live.attachmentsTruncated ? "+" : ""}` : undefined}
              aside={
                editable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground"
                    onClick={attachDocuments}
                    disabled={attaching}
                    aria-label={attaching ? "Attaching…" : "Attach document…"}
                  >
                    {attaching ? <Loader2 className="animate-spin" /> : <Paperclip />}
                    {attaching ? "Attaching…" : "Attach"}
                  </Button>
                ) : undefined
              }
            >
              {live.attachments.length === 0 && <p className="text-[13px] text-muted-foreground">Nothing attached yet.</p>}
              {live.attachments.length > 0 && (
              <ul className="-mx-4 border-y border-border">
                {live.attachments.map((attachment) => (
                  <li key={attachment.id} className="issue-row flex min-w-0 items-center transition-colors hover:bg-accent">
                    <button
                      type="button"
                      onClick={() => setExpandedResource(attachment)}
                      className="dash-control flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 pr-2 text-left"
                    >
                      <ResourceIcon url={attachment.url} sourceType={attachment.sourceType} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{attachment.title}</span>
                      {attachment.subtitle && <span className="hidden max-w-52 truncate text-[12px] text-muted-foreground sm:inline">{attachment.subtitle}</span>}
                      <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{timeAgo(attachment.createdAt)}</span>
                    </button>
                    <Popover
                      align="end"
                      buttonTitle="Resource actions"
                      buttonClassName={`${ICON_BUTTON} mr-2`}
                      button={<MoreHorizontal className="size-4" />}
                      panelClassName={`w-52 ${MENU_PANEL}`}
                    >
                      {(close) => (
                        <ResourceActionsMenu
                          attachment={attachment}
                          issueId={id}
                          editable={editable}
                          close={close}
                          onExpand={() => (setExpandedResource(attachment), close())}
                          onOpenOriginal={() => {
                            close();
                            const external = safeExternalUrl(attachment.url);
                            if (external) openUrl(external).catch(() => gooeyToast.error("Couldn't open the resource"));
                            else gooeyToast.error("Blocked unsafe link");
                          }}
                        />
                      )}
                    </Popover>
                  </li>
                ))}
                {live.attachmentsTruncated && (
                  <li className="px-4 py-2 text-[12px] text-muted-foreground">Showing the first 50 resources.</li>
                )}
              </ul>
              )}
            </DrawerSection>
          )}

          {docLinks && <div className="mt-8 border-t border-border pt-4">{docLinks}</div>}

          {live && (
            <DrawerSection title="Activity">
              <div className="space-y-4">
                <ol className="space-y-3">
                  {timeline.map((entry) =>
                    entry.kind === "event" ? (
                      <li key={entry.key} className="flex gap-3">
                        <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
                          {eventIcon(entry.event)}
                        </span>
                        <p className="min-w-0 flex-1 pt-0.5 text-[13px] leading-5 text-muted-foreground">
                          <span className="font-medium text-foreground">{entry.event.actorName ?? "Linear"}</span>{" "}
                          {entry.event.summary}
                          <span className="tabular-nums"> · {timeAgo(entry.event.createdAt)}</span>
                        </p>
                      </li>
                    ) : (
                      <li key={entry.key}>
                        <CommentThread thread={entry.thread} issueId={id} onOpenLink={handleLink} resolveMention={resolveMention} />
                      </li>
                    ),
                  )}
                </ol>
                {timeline.length === 0 && (
                  <p className="text-[13px] text-muted-foreground">No activity yet.</p>
                )}
                {(live.hasMoreHistory || live.hasMoreComments) && (
                  <p className="text-[12px] text-muted-foreground">Showing the first 50 history events and comments.</p>
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
          aria-label="Properties"
          className="drawer-scrollbar flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-border pb-24 @max-[760px]:w-[232px]"
          onContextMenu={(e) => openMenu(e, id)}
        >
          <RailSection title="properties">
            <Field
              title="Status"
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
              title="Priority"
              icon={<PriorityIcon p={priority} />}
              label={PRIORITIES.find((p) => p.value === priority)?.label ?? "No priority"}
              disabled={!editable}
              menu={(close) =>
                PRIORITIES.map((p) => (
                  <PopoverItem key={p.value} icon={<PriorityIcon p={p.value} />} label={p.label} active={p.value === priority} onClick={() => (patch({ priority: p.value }), close())} />
                ))
              }
            />
            <AssigneeSelect
              value={d.assigneeId ?? null}
              onChange={(uid) => patch({ assigneeId: uid })}
              users={users.data ?? []}
              emptyLabel="Unassigned"
              disabled={!editable}
              triggerClassName={FIELD_ROW}
            />
            <Field
              title="Estimate"
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
              title="Cycle"
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
            <DatePicker value={dueDate} onChange={(v) => patch({ dueDate: v })} disabled={!editable} triggerClassName={FIELD_ROW} />
          </RailSection>

          <RailSection
            title="labels"
            action={
              editable ? (
                <Popover
                  align="end"
                  buttonTitle="Add label"
                  buttonClassName={`${ICON_BUTTON} size-6`}
                  button={<Plus className="size-3.5" />}
                  panelClassName={MENU_PANEL}
                >
                  {() => {
                    const appliedIds = new Set(live?.labels.map((x) => x.id) ?? []);
                    const toggle = (labelId: string) => {
                      const ids = live?.labels.map((x) => x.id) ?? [];
                      patch({ labelIds: appliedIds.has(labelId) ? ids.filter((x) => x !== labelId) : [...ids, labelId] });
                    };
                    const handleCreated = (newId: string) => {
                      patch({ labelIds: [...(live?.labels.map((x) => x.id) ?? []), newId] });
                    };
                    return (
                      <LabelDropdown
                        allLabels={labels ?? []}
                        appliedIds={appliedIds}
                        teamId={d.teamId}
                        onToggle={toggle}
                        onCreated={handleCreated}
                      />
                    );
                  }}
                </Popover>
              ) : undefined
            }
          >
            <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1">
              {live?.labels.map((l) => (
                <span key={l.id} className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[12px] text-foreground">
                  <span className="size-2 rounded-full" style={{ backgroundColor: l.color ?? "var(--muted-foreground)" }} />
                  {l.name}
                </span>
              ))}
              {(!live || live.labels.length === 0) && <span className="text-[13px] text-muted-foreground">No labels</span>}
            </div>
          </RailSection>

          <RailSection title="project">
            <Field
              title="Project"
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
          </RailSection>

          {live && live.relations.length > 0 && (
            <RailSection title="relations">
              <div className="flex flex-col gap-2 pb-1">
                {groupRelations(live.relations).map(([type, items]) => (
                  <div key={type} className="flex flex-col">
                    <span className="px-2 pb-0.5 text-[12px] font-medium text-muted-foreground">{relationGroupLabel(type).toLowerCase()}</span>
                    {items.map((relation, index) => (
                      <button
                        key={`${relation.issue.id}-${index}`}
                        type="button"
                        onClick={() => openIssue(relation.issue.id)}
                        title={`${relation.issue.identifier} ${relation.issue.title}`}
                        className={FIELD_ROW}
                      >
                        <span className="flex size-3.5 shrink-0 items-center justify-center">
                          {relation.issue.stateType ? (
                            <StatusIcon type={relation.issue.stateType} color={relation.issue.stateColor ?? ""} />
                          ) : (
                            <Link2 className="size-3.5 text-muted-foreground" />
                          )}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">{relation.issue.identifier}</span>
                        <span className="truncate">{relation.issue.title}</span>
                      </button>
                    ))}
                  </div>
                ))}
                {live.hasMoreRelations && <p className="px-2 pt-1 text-[12px] text-muted-foreground">Showing the first 50 relations.</p>}
              </div>
            </RailSection>
          )}

        </aside>
      </div>
      {expandedResource && (
        <ResourceModal
          attachment={expandedResource}
          markdownComponents={md}
          users={users.data ?? []}
          onClose={() => setExpandedResource(null)}
        />
      )}
    </>
  );
}

function ResourceModal({
  attachment,
  markdownComponents,
  users,
  onClose,
}: {
  attachment: DetailAttachment;
  markdownComponents: Components;
  users: LinearUser[];
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const userMentionPlugin = useMemo(() => createUserMentionRemarkPlugin(users), [users]);
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
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
      <section role="dialog" aria-modal="true" aria-labelledby="resource-modal-title" className="issues-overlay drawer-scrollbar flex max-h-[84vh] w-[min(760px,92vw)] flex-col overflow-hidden rounded-lg border border-border bg-popover">
        <header className="flex items-start gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 id="resource-modal-title" className="truncate text-[15px] font-semibold tracking-tight text-foreground">{attachment.title}</h2>
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{attachment.subtitle ?? attachment.sourceType ?? "Resource"}</p>
          </div>
          <IconBtn title="Open original" onClick={openOriginal}><ExternalLink className="size-4" /></IconBtn>
          <button ref={closeRef} type="button" aria-label="Close resource" title="Close" onClick={onClose} className={ICON_BUTTON}>
            <X className="size-4" />
          </button>
        </header>
        <div className="drawer-scrollbar min-h-0 overflow-y-auto px-6 py-5">
          {attachment.body ? (
            <div className="astryn-prose max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm, userMentionPlugin]} components={markdownComponents} urlTransform={mentionAwareUrlTransform}>{attachment.body}</ReactMarkdown>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <IndicatorLamp tone="off" />
              <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">This resource does not include expandable content.</p>
              <Button type="button" variant="outline" onClick={openOriginal}>Open original</Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/** A main-column zone: a hairline above, a 13px title with its reading, and an optional action. */
function DrawerSection({ title, meta, aside, children }: { title: string; meta?: string; aside?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="mt-8 border-t border-border pt-3">
      <div className="mb-2 flex min-h-8 items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="dash-control -ml-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] font-semibold tracking-tight text-foreground transition-colors hover:bg-accent"
        >
          {title}
          {meta && <span className="font-normal tabular-nums text-muted-foreground">{meta}</span>}
          <ChevronDown className={`size-3.5 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
        </button>
        {aside && <div className="ml-auto flex items-center">{aside}</div>}
      </div>
      {open && children}
    </section>
  );
}

/** Square icon button for headers and row actions. */
const ICON_BUTTON =
  "dash-control flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className={ICON_BUTTON}>
      {children}
    </button>
  );
}

/** A rail zone: a lowercase legend that collapses it, an optional action, then its rows. A hairline separates zones. */
function RailSection({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b border-border px-2 pt-2 pb-2.5">
      <div className="flex min-h-7 items-center gap-1 px-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="dash-control flex flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {title}
          <ChevronDown className={`size-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
        </button>
        {action}
      </div>
      {open && <div className="mt-0.5">{children}</div>}
    </section>
  );
}

/** A clickable property row that opens a portal dropdown (read-only when disabled). */
function Field({ title, icon, label, menu, disabled }: { title: string; icon: ReactNode; label: ReactNode; menu: (close: () => void) => ReactNode; disabled?: boolean }) {
  // Fixed-width, centered icon slot so every row's label starts at the same x
  // regardless of the leading icon's intrinsic size (e.g. the priority bars
  // vs the 14px status icon) — keeps the rail's labels in one clean column.
  const content = (
    <>
      <span className="flex size-3.5 shrink-0 items-center justify-center">{icon}</span>
      <span className="truncate">{label}</span>
    </>
  );
  if (disabled) {
    return <div title={title} className="flex min-w-0 items-center gap-2 px-2 py-1.5 text-[13px] text-foreground">{content}</div>;
  }
  return (
    <Popover
      align="end"
      buttonTitle={title}
      buttonClassName={FIELD_ROW}
      panelClassName={`max-h-[18rem] w-60 overflow-y-auto ${MENU_PANEL}`}
      button={<span className="flex min-w-0 items-center gap-2">{content}</span>}
    >
      {menu}
    </Popover>
  );
}
