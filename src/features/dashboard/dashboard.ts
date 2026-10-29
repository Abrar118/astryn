import type {
  GithubPr,
  IssueListItem,
  Notification,
  SlackCatchup,
} from "@/lib/commands";
import { addDays } from "@/lib/dates";
import { fmtDate } from "@/features/issues/IssueRow";

export type DashboardInput = {
  issues: IssueListItem[];
  prs: GithubPr[];
  notifications: Notification[];
  slack: SlackCatchup | undefined;
  /** The viewer's id in each active tracker; tasks assigned to any of them are "mine". */
  viewerIds: readonly string[];
  today: string;
  /** Which sources are on (`tracker`: any task tracker, `inbox`: Linear notifications); absent counts as on. */
  active?: { tracker?: boolean; inbox?: boolean; github?: boolean; slack?: boolean };
};

export function noModulesActive(active: NonNullable<DashboardInput["active"]>): boolean {
  return !active.tracker && !active.inbox && !active.github && !active.slack;
}

/** Drop the data of every source that is off. */
function gated(input: DashboardInput): DashboardInput {
  const { tracker = true, inbox = true, github = true, slack = true } = input.active ?? {};
  return {
    ...input,
    issues: tracker ? input.issues : [],
    notifications: inbox ? input.notifications : [],
    prs: github ? input.prs : [],
    slack: slack ? input.slack : undefined,
  };
}

export type DashboardMetrics = {
  overdue: number;
  reviews: number;
  inbox: number;
  mentions: number;
};

export type AttentionItem = {
  key: string;
  source: "task" | "github" | "slack" | "inbox";
  target: "issue" | "prs" | "slack" | "inbox";
  entityId: string | null;
  context: string;
  title: string;
  detail: string;
  tone: "danger" | "warning" | "info" | "neutral";
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
  { key: "started", label: "In progress", color: "var(--primary)" },
  { key: "unstarted", label: "Todo", color: "color-mix(in oklab, var(--primary) 45%, transparent)" },
  { key: "backlog", label: "Backlog", color: "var(--muted-foreground)" },
];

const PRIORITY_ORDER = [1, 2, 3, 4, 0];

function isActive(stateType: string): boolean {
  return stateType !== "completed" && stateType !== "canceled";
}

function viewerIssue(issue: IssueListItem, viewerIds: readonly string[]): boolean {
  return issue.assigneeId !== null && viewerIds.includes(issue.assigneeId);
}

function isOverdue(issue: IssueListItem, viewerIds: readonly string[], today: string): boolean {
  return viewerIssue(issue, viewerIds)
    && isActive(issue.stateType)
    && issue.dueDate !== null
    && issue.dueDate < today;
}

function distinctPrCount(prs: GithubPr[], predicate: (pr: GithubPr) => boolean): number {
  return new Set(prs.filter(predicate).map((pr) => pr.id)).size;
}

export function dashboardMetrics(raw: DashboardInput): DashboardMetrics {
  const input = gated(raw);
  return {
    overdue: input.issues.filter((issue) => isOverdue(issue, input.viewerIds, input.today)).length,
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
    tone: critical ? "danger" : "info",
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

export function attentionItems(raw: DashboardInput, limit = 8): AttentionItem[] {
  const input = gated(raw);
  const items: AttentionItem[] = input.issues
    .filter((issue) => isOverdue(issue, input.viewerIds, input.today))
    .map((issue) => ({
      key: `task:${issue.id}`,
      source: "task",
      target: "issue",
      entityId: issue.id,
      context: issue.identifier,
      title: issue.title,
      detail: `Overdue since ${fmtDate(issue.dueDate ?? "")}`,
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
      tone: "neutral",
      rank: 4,
      sortAt: notification.createdAt,
    });
  }

  return items.sort(compareAttention).slice(0, Math.max(0, limit));
}

export function workloadBuckets(
  issues: IssueListItem[],
  viewerIds: readonly string[],
): WorkloadBucket[] {
  const counts = new Map<WorkloadBucket["key"], number>();
  for (const issue of issues) {
    if (!viewerIssue(issue, viewerIds) || !isActive(issue.stateType)) continue;
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
  viewerIds: readonly string[],
  today: string,
  days = 7,
): DueLoadDay[] {
  const countByDate = new Map<string, number>();
  for (const issue of issues) {
    if (!viewerIssue(issue, viewerIds) || !isActive(issue.stateType) || !issue.dueDate) continue;
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
  viewerIds: readonly string[],
  today: string,
  limit = 5,
): IssueListItem[] {
  const dayOfWeek = new Date(`${today}T00:00:00Z`).getUTCDay();
  const weekStart = addDays(today, -dayOfWeek);
  const weekEnd = addDays(weekStart, 7);
  return issues
    .filter((issue) =>
      viewerIssue(issue, viewerIds)
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
