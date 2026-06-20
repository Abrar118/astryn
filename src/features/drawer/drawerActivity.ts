import type { DetailHistory } from "@/lib/commands";

export type ActivityItem =
  | { kind: "created"; id: string; createdAt: string; actorName: string | null; summary: string }
  | { kind: "history"; id: string; createdAt: string; actorName: string | null; summary: string };

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
    })),
  );
  return items.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
