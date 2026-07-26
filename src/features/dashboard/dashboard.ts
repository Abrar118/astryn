import type {
  GithubPr,
  IssueListItem,
  Notification,
  SlackCatchup,
} from "@/lib/commands";
import { addDays } from "@/lib/dates";

export type DashboardInput = {
  issues: IssueListItem[];
  prs: GithubPr[];
  notifications: Notification[];
  slack: SlackCatchup | undefined;
  viewerId: string | null;
  today: string;
};

export type DashboardMetrics = {
  overdue: number;
  reviews: number;
  inbox: number;
  mentions: number;
};

export type AttentionItem = {
  key: string;
  source: "linear" | "github" | "slack" | "inbox";
  target: "issue" | "prs" | "slack" | "inbox";
  entityId: string | null;
  context: string;
  title: string;
  detail: string;
  tone: "danger" | "warning" | "violet" | "cyan";
  rank: number;
  sortAt: string;
};

export type WorkloadBucket = {
  key: "started" | "unstarted" | "backlog";
  label: string;
  count: number;
  color: string;
};

export type DueLoadDay = {
  date: string;
  label: string;
  count: number;
};

const WORKLOAD_BUCKETS: Omit<WorkloadBucket, "count">[] = [
  { key: "started", label: "In progress", color: "#818cf8" },
  { key: "unstarted", label: "Todo", color: "#22d3ee" },
  { key: "backlog", label: "Backlog", color: "#64748b" },
];

const PRIORITY_ORDER = [1, 2, 3, 4, 0];

function isActive(stateType: string): boolean {
  return stateType !== "completed" && stateType !== "canceled";
}

function viewerIssue(issue: IssueListItem, viewerId: string | null): boolean {
  return viewerId !== null && issue.assigneeId === viewerId;
}

function isOverdue(issue: IssueListItem, viewerId: string | null, today: string): boolean {
  return viewerIssue(issue, viewerId)
    && isActive(issue.stateType)
    && issue.dueDate !== null
    && issue.dueDate < today;
}

function distinctPrCount(prs: GithubPr[], predicate: (pr: GithubPr) => boolean): number {
  return new Set(prs.filter(predicate).map((pr) => pr.id)).size;
}

export function dashboardMetrics(input: DashboardInput): DashboardMetrics {
  return {
    overdue: input.issues.filter((issue) => isOverdue(issue, input.viewerId, input.today)).length,
    reviews: distinctPrCount(input.prs, (pr) => pr.bucket === "needs_review"),
    inbox: input.notifications.filter((notification) => !notification.read).length,
    mentions: input.slack?.mentions.length ?? 0,
  };
}

function prAttention(pr: GithubPr): AttentionItem | null {
  const changesRequested = pr.bucket === "mine" && pr.reviewDecision === "changes_requested";
  const conflicting = pr.mergeable === "conflicting";
  const needsReview = pr.bucket === "needs_review";
  if (!changesRequested && !conflicting && !needsReview) return null;

  const critical = changesRequested || conflicting;
  return {
    key: `github:${pr.id}`,
    source: "github",
    target: "prs",
    entityId: pr.id,
    context: `${pr.repo} #${pr.number}`,
    title: pr.title ?? "Untitled pull request",
    detail: changesRequested
      ? "Changes requested"
      : conflicting
        ? "Merge conflict"
        : "Review requested",
    tone: critical ? "danger" : "violet",
    rank: critical ? 1 : 2,
    sortAt: pr.updatedAt ?? "",
  };
}

function compareAttention(a: AttentionItem, b: AttentionItem): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const timeOrder = a.rank === 0
    ? a.sortAt.localeCompare(b.sortAt)
    : b.sortAt.localeCompare(a.sortAt);
  return timeOrder || a.key.localeCompare(b.key);
}

export function attentionItems(input: DashboardInput, limit = 8): AttentionItem[] {
  const items: AttentionItem[] = input.issues
    .filter((issue) => isOverdue(issue, input.viewerId, input.today))
    .map((issue) => ({
      key: `linear:${issue.id}`,
      source: "linear",
      target: "issue",
      entityId: issue.id,
      context: issue.identifier,
      title: issue.title,
      detail: `Due ${issue.dueDate}`,
      tone: "danger",
      rank: 0,
      sortAt: issue.dueDate ?? "",
    }));

  const prsById = new Map<string, AttentionItem>();
  for (const pr of input.prs) {
    const candidate = prAttention(pr);
    if (!candidate) continue;
    const existing = prsById.get(pr.id);
    if (!existing || compareAttention(candidate, existing) < 0) {
      prsById.set(pr.id, candidate);
    }
  }
  items.push(...prsById.values());

  for (const mention of input.slack?.mentions ?? []) {
    items.push({
      key: `slack:${mention.conversationId}:${mention.ts}`,
      source: "slack",
      target: "slack",
      entityId: mention.conversationId,
      context: mention.userName ?? "Slack",
      title: mention.text?.trim() || "You were mentioned",
      detail: "Mention",
      tone: "warning",
      rank: 3,
      sortAt: mention.createdAt,
    });
  }

  for (const notification of input.notifications) {
    if (notification.read) continue;
    items.push({
      key: `inbox:${notification.id}`,
      source: "inbox",
      target: "inbox",
      entityId: notification.issueId,
      context: notification.issueIdentifier,
      title: notification.issueTitle,
      detail: notification.actorName
        ? `${notification.actorName} · Inbox`
        : "Unread notification",
      tone: "cyan",
      rank: 4,
      sortAt: notification.createdAt,
    });
  }

  return items.sort(compareAttention).slice(0, Math.max(0, limit));
}

export function workloadBuckets(
  issues: IssueListItem[],
  viewerId: string | null,
): WorkloadBucket[] {
  const counts = new Map<WorkloadBucket["key"], number>();
  for (const issue of issues) {
    if (!viewerIssue(issue, viewerId) || !isActive(issue.stateType)) continue;
    if (issue.stateType === "started" || issue.stateType === "unstarted" || issue.stateType === "backlog") {
      counts.set(issue.stateType, (counts.get(issue.stateType) ?? 0) + 1);
    }
  }
  return WORKLOAD_BUCKETS.map((bucket) => ({
    ...bucket,
    count: counts.get(bucket.key) ?? 0,
  }));
}

function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function dueLoad(
  issues: IssueListItem[],
  viewerId: string | null,
  today: string,
  days = 7,
): DueLoadDay[] {
  const countByDate = new Map<string, number>();
  for (const issue of issues) {
    if (!viewerIssue(issue, viewerId) || !isActive(issue.stateType) || !issue.dueDate) continue;
    countByDate.set(issue.dueDate, (countByDate.get(issue.dueDate) ?? 0) + 1);
  }
  return Array.from({ length: Math.max(0, days) }, (_, index) => {
    const date = addDays(today, index);
    return {
      date,
      label: dayLabel(date, today),
      count: countByDate.get(date) ?? 0,
    };
  });
}

function priorityRank(priority: number): number {
  const rank = PRIORITY_ORDER.indexOf(priority);
  return rank === -1 ? PRIORITY_ORDER.length : rank;
}

export function weekPreview(
  issues: IssueListItem[],
  viewerId: string | null,
  today: string,
  limit = 5,
): IssueListItem[] {
  const dayOfWeek = new Date(`${today}T00:00:00Z`).getUTCDay();
  const weekStart = addDays(today, -dayOfWeek);
  const weekEnd = addDays(weekStart, 7);
  return issues
    .filter((issue) =>
      viewerIssue(issue, viewerId)
      && isActive(issue.stateType)
      && issue.dueDate !== null
      && issue.dueDate < weekEnd)
    .sort((a, b) => {
      const dateOrder = (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
      if (dateOrder) return dateOrder;
      const priorityOrder = priorityRank(a.priority) - priorityRank(b.priority);
      return priorityOrder || a.identifier.localeCompare(b.identifier);
    })
    .slice(0, Math.max(0, limit));
}
