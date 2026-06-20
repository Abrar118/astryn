import type { DetailHistory } from "@/lib/commands";
import type { CommentThreadData } from "./comments/commentThreads";

export type HistoryCategory =
  | "status" | "assignee" | "priority" | "title" | "description" | "relation" | "attachment" | "update";

export function historyCategory(event: DetailHistory): HistoryCategory {
  if (event.attachment) return "attachment";
  if (event.relationChanges.length > 0) return "relation";
  if (event.fromStateName || event.toStateName) return "status";
  if (event.fromAssigneeName || event.toAssigneeName) return "assignee";
  if (event.fromPriority != null || event.toPriority != null) return "priority";
  if (event.fromTitle != null || event.toTitle != null) return "title";
  if (event.updatedDescription) return "description";
  return "update";
}

export type ActivityItem =
  | { kind: "created"; id: string; createdAt: string; actorName: string | null; summary: string }
  | {
      kind: "history"; id: string; createdAt: string; actorName: string | null; summary: string;
      category: HistoryCategory;
      toStateType: string | null; toStateColor: string | null;
      toAssigneeName: string | null; toPriority: number | null;
    };

const PRIORITY_NAMES = ["No priority", "Urgent", "High", "Medium", "Low"];

function priorityName(value: number | null): string {
  return value == null ? "none" : (PRIORITY_NAMES[value] ?? String(value));
}

export function historySummary(event: DetailHistory): string {
  if (event.attachment) return `linked ${event.attachment.title}`;
  if (event.relationChanges.length > 0) {
    const change = event.relationChanges[0];
    const type = change.type.toLowerCase();
    if (type.includes("remove")) return `removed relation to ${change.identifier}`;
    if (type.includes("add")) return `added related issue ${change.identifier}`;
    return `${change.type || "related"} issue ${change.identifier}`;
  }
  if (event.fromStateName || event.toStateName) {
    return `moved from ${event.fromStateName ?? "No status"} to ${event.toStateName ?? "No status"}`;
  }
  if (event.fromAssigneeName || event.toAssigneeName) {
    if (!event.toAssigneeName) return `unassigned ${event.fromAssigneeName ?? "the assignee"}`;
    if (!event.fromAssigneeName) return `assigned to ${event.toAssigneeName}`;
    return `reassigned from ${event.fromAssigneeName} to ${event.toAssigneeName}`;
  }
  if (event.fromPriority != null || event.toPriority != null) {
    return `changed priority from ${priorityName(event.fromPriority)} to ${priorityName(event.toPriority)}`;
  }
  if (event.fromTitle != null || event.toTitle != null) return "changed the title";
  if (event.updatedDescription) return "updated the description";
  return "updated the issue";
}

export type TimelineEntry =
  | { kind: "event"; key: string; createdAt: string; event: ActivityItem }
  | { kind: "thread"; key: string; createdAt: string; thread: CommentThreadData };

/** Merge activity events + comment threads into one list sorted oldest-first by createdAt
 *  (threads positioned by their top-level comment's createdAt). */
export function mergeActivityTimeline(
  activity: ActivityItem[],
  threads: CommentThreadData[],
): TimelineEntry[] {
  const events: TimelineEntry[] = activity.map((event) => ({
    kind: "event", key: event.id, createdAt: event.createdAt, event,
  }));
  const threadEntries: TimelineEntry[] = threads.map((thread) => ({
    kind: "thread", key: `thread-${thread.comment.id}`, createdAt: thread.comment.createdAt, thread,
  }));
  return [...events, ...threadEntries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function buildActivity(input: {
  createdAt: string;
  creatorName: string | null;
  history: DetailHistory[];
}): ActivityItem[] {
  const items: ActivityItem[] = [];
  if (input.createdAt) {
    items.push({
      kind: "created",
      id: "issue-created",
      createdAt: input.createdAt,
      actorName: input.creatorName,
      summary: "created the issue",
    });
  }
  items.push(
    ...input.history.map((event): ActivityItem => ({
      kind: "history",
      id: `history-${event.id}`,
      createdAt: event.createdAt,
      actorName: event.actorName,
      summary: historySummary(event),
      category: historyCategory(event),
      toStateType: event.toStateType,
      toStateColor: event.toStateColor,
      toAssigneeName: event.toAssigneeName,
      toPriority: event.toPriority,
    })),
  );
  return items.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
