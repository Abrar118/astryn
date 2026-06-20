import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import {
  Box,
  CalendarDays,
  Gauge,
  GitPullRequest,
  IterationCcw,
  Link2,
  Milestone,
} from "lucide-react";
import { dhakaDateFromTimestamp, isOverdue } from "@/lib/dates";
import type { IssueListItem, Label } from "@/lib/commands";
import { Avatar } from "@/components/Avatar";
import { StatusIcon } from "../drawer/issueGlyphs";
import type { DisplayProps, Ordering } from "./viewConfig";

export const PRIORITY_LABELS = ["No priority", "Urgent", "High", "Medium", "Low"];
export const PRIORITY_COLORS = ["#6b7280", "#ef4444", "#f97316", "#eab308", "#3b82f6"];
export const PRIORITY_ORDER = [1, 2, 3, 4, 0]; // Urgent → High → Medium → Low → None

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const STATE_RANK: Record<string, number> = {
  backlog: 0,
  unstarted: 1,
  started: 2,
  completed: 3,
  canceled: 4,
};

export function fmtDate(d: string): string {
  const [, m, day] = d.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${day}`;
}

function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/** Relative-friendly due label in Dhaka calendar terms. */
export function dueLabel(d: string, today: string): string {
  const diff = dayDiff(today, d);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  return fmtDate(d);
}

export function cycleText(i: IssueListItem): string | null {
  if (i.cycleName) return i.cycleName;
  if (i.cycleNumber != null) return `Cycle ${i.cycleNumber}`;
  return null;
}

/** Three-bar priority glyph (Linear-style). Urgent renders in red. */
export function PriorityIcon({ p }: { p: number }) {
  const filled = p === 0 ? 0 : p === 4 ? 1 : p === 3 ? 2 : 3; // low=1, medium=2, high/urgent=3
  const urgent = p === 1;
  const label = `Priority: ${PRIORITY_LABELS[p] ?? "No priority"}`;
  return (
    <span className="inline-flex items-end gap-[2px]" title={label} aria-label={label}>
      {[4, 7, 10].map((h, i) => (
        <span
          key={i}
          style={{ height: h }}
          className={`w-[3px] rounded-[1px] ${i < filled ? (urgent ? "bg-red-500" : "bg-muted-foreground") : "bg-border"}`}
        />
      ))}
    </span>
  );
}

export function Pill({ children, className = "", title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground ${className}`}
    >
      {children}
    </span>
  );
}

/** Up to `max` label chips (colored dot + name), then a "+N" overflow pill. */
export function LabelPills({ labels, max = 2 }: { labels: Label[]; max?: number }) {
  if (labels.length === 0) return null;
  const shown = labels.slice(0, max);
  const extra = labels.slice(max);
  return (
    <span className="flex shrink-0 items-center gap-1">
      {shown.map((l) => (
        <Pill key={l.id} title={`Label: ${l.name ?? "label"}`}>
          <span className="size-1.5 rounded-full" style={{ backgroundColor: l.color ?? "#6b7280" }} />
          <span className="max-w-24 truncate">{l.name ?? "label"}</span>
        </Pill>
      ))}
      {extra.length > 0 && (
        <Pill title={`Labels: ${extra.map((l) => l.name ?? "label").join(", ")}`}>+{extra.length}</Pill>
      )}
    </span>
  );
}

type AvatarInfo = { name: string } | null;

export function MetaCluster({
  issue,
  display,
  avatar,
  today,
}: {
  issue: IssueListItem;
  display: DisplayProps;
  avatar: AvatarInfo;
  today: string;
}) {
  const overdue = isOverdue(issue.dueDate, issue.stateType, today);
  const cycle = cycleText(issue);
  return (
    <div className="flex shrink-0 items-center gap-2">
      {display.status && issue.stateName && (
        <Pill title={`Status: ${issue.stateName}`}>
          <StatusIcon type={issue.stateType} color={issue.stateColor} />
          <span className="hidden lg:inline">{issue.stateName}</span>
        </Pill>
      )}
      {display.labels && <span className="hidden lg:flex"><LabelPills labels={issue.labels} /></span>}
      {display.project && issue.projectName && (
        <Pill className="hidden md:inline-flex" title={`Project: ${issue.projectName}`}>
          <Box className="size-3" />
          <span className="max-w-32 truncate">{issue.projectName}</span>
        </Pill>
      )}
      {display.milestone && issue.milestoneName && (
        <Pill className="hidden lg:inline-flex" title={`Milestone: ${issue.milestoneName}`}>
          <Milestone className="size-3" />
          <span className="max-w-28 truncate">{issue.milestoneName}</span>
        </Pill>
      )}
      {display.cycle && cycle && (
        <Pill className="hidden lg:inline-flex" title={`Cycle: ${cycle}`}>
          <IterationCcw className="size-3" />
          {cycle}
        </Pill>
      )}
      {display.estimate && issue.estimate != null && (
        <Pill title={`Estimate: ${issue.estimate} points`}>
          <Gauge className="size-3" />
          {issue.estimate}
        </Pill>
      )}
      {display.pullRequests && issue.prCount > 0 && (
        <Pill title={`${issue.attachmentsTruncated ? "At least " : ""}${issue.prCount} pull request${issue.prCount === 1 ? "" : "s"}`}>
          <GitPullRequest className="size-3" />
          {issue.prCount}{issue.attachmentsTruncated ? "+" : ""}
        </Pill>
      )}
      {display.links && issue.linkCount > 0 && (
        <Pill title={`${issue.attachmentsTruncated ? "At least " : ""}${issue.linkCount} link${issue.linkCount === 1 ? "" : "s"}`}>
          <Link2 className="size-3" />
          {issue.linkCount}{issue.attachmentsTruncated ? "+" : ""}
        </Pill>
      )}
      {display.priority && (
        <span className="hidden sm:flex">
          <PriorityIcon p={issue.priority} />
        </span>
      )}
      {display.dueDate && issue.dueDate && (
        <Pill
          className={overdue ? "border-red-500/40 text-red-400" : ""}
          title={`Due date: ${fmtDate(issue.dueDate)}${overdue ? " (overdue)" : ""}`}
        >
          <CalendarDays className="size-3" />
          {dueLabel(issue.dueDate, today)}
        </Pill>
      )}
      {display.created && (
        <span
          className="hidden w-14 shrink-0 text-right text-[11px] text-muted-foreground xl:inline"
          title={`Created ${fmtDate(dhakaDateFromTimestamp(issue.createdAt))}`}
        >
          {fmtDate(dhakaDateFromTimestamp(issue.createdAt))}
        </span>
      )}
      {display.updated && (
        <span
          className="hidden w-14 shrink-0 text-right text-[11px] text-muted-foreground xl:inline"
          title={`Updated ${fmtDate(dhakaDateFromTimestamp(issue.updatedAt))}`}
        >
          {fmtDate(dhakaDateFromTimestamp(issue.updatedAt))}
        </span>
      )}
      {display.assignee &&
        (avatar ? (
          <span title={`Assignee: ${avatar.name}`} className="flex">
            <Avatar name={avatar.name} size={20} />
          </span>
        ) : (
          <span title="Unassigned" className="size-5 shrink-0 rounded-full border border-dashed border-border" />
        ))}
    </div>
  );
}

export function IssueRow({
  issue,
  display,
  avatar,
  onOpen,
  onContextMenu,
  today,
}: {
  issue: IssueListItem;
  display: DisplayProps;
  avatar: AvatarInfo;
  onOpen: (id: string) => void;
  onContextMenu: (e: ReactMouseEvent) => void;
  today: string;
}) {
  return (
    <div
      onClick={() => onOpen(issue.id)}
      onContextMenu={onContextMenu}
      className="group flex cursor-pointer items-center gap-3 border-b border-border/40 px-4 py-2 text-sm transition-colors last:border-b-0 hover:bg-accent/50"
    >
      <span title={`Status: ${issue.stateName || issue.stateType || "No status"}`} className="flex">
        <StatusIcon type={issue.stateType} color={issue.stateColor} />
      </span>
      {display.id && (
        <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground" title={issue.identifier}>
          {issue.identifier}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-foreground">{issue.title}</span>
      <MetaCluster issue={issue} display={display} avatar={avatar} today={today} />
    </div>
  );
}

export function compareIssues(a: IssueListItem, b: IssueListItem, by: Ordering): number {
  switch (by) {
    case "priority":
      return PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
    case "dueDate":
      return (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99");
    case "title":
      return a.title.localeCompare(b.title);
    case "created":
      return b.createdAt.localeCompare(a.createdAt); // newest first
    case "updated":
      return b.updatedAt.localeCompare(a.updatedAt); // newest first
    case "status":
    default:
      return (STATE_RANK[a.stateType] ?? 9) - (STATE_RANK[b.stateType] ?? 9);
  }
}
