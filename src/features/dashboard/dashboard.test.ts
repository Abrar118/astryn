import { describe, expect, it } from "vitest";
import type {
  GithubPr,
  IssueListItem,
  Notification,
  SlackCatchup,
  SlackMessage,
} from "@/lib/commands";
import {
  attentionItems,
  dashboardMetrics,
  dueLoad,
  weekPreview,
  workloadBuckets,
  type DashboardInput,
} from "./dashboard";

function issue(overrides: Partial<IssueListItem> = {}): IssueListItem {
  return {
    id: "issue-1",
    identifier: "GAM-1",
    title: "Test issue",
    description: null,
    dueDate: null,
    startedAt: null,
    priority: 0,
    url: "https://linear.app/issue/GAM-1",
    stateId: "state-1",
    stateName: "Todo",
    stateType: "unstarted",
    stateColor: "#64748b",
    assigneeId: "viewer",
    assigneeName: "Abrar",
    teamId: "team-1",
    teamKey: "GAM",
    projectId: null,
    projectName: null,
    parentId: null,
    estimate: null,
    cycleName: null,
    cycleNumber: null,
    milestoneName: null,
    linkCount: 0,
    prCount: 0,
    attachmentsTruncated: false,
    createdAt: "2026-07-20T10:00:00Z",
    updatedAt: "2026-07-25T10:00:00Z",
    labels: [],
    ...overrides,
  };
}

function pr(overrides: Partial<GithubPr> = {}): GithubPr {
  return {
    id: "repo#1",
    bucket: "mine",
    repo: "gam/app",
    number: 1,
    title: "Test pull request",
    draft: false,
    mergeable: "mergeable",
    ciStatus: "success",
    reviewDecision: null,
    authorLogin: "abrar",
    authorAvatar: null,
    commentCount: 0,
    branch: "gam-1",
    baseBranch: "main",
    url: "https://github.com/gam/app/pull/1",
    linearIdentifier: "GAM-1",
    linearIssueId: "issue-1",
    updatedAt: "2026-07-25T10:00:00Z",
    mergedAt: null,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    linearStateName: "Todo",
    linearStateType: "unstarted",
    linearStateColor: "#64748b",
    linearPriority: 0,
    reviewers: [],
    ...overrides,
  };
}

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "notification-1",
    kind: "issueCommentMention",
    createdAt: "2026-07-25T10:00:00Z",
    read: false,
    actorName: "Rafi",
    issueId: "issue-1",
    issueIdentifier: "GAM-1",
    issueTitle: "Test issue",
    issueStateType: "unstarted",
    issueStateColor: "#64748b",
    issueProjectName: null,
    ...overrides,
  };
}

function message(overrides: Partial<SlackMessage> = {}): SlackMessage {
  return {
    conversationId: "channel-1",
    ts: "100.1",
    threadTs: null,
    userId: "user-1",
    userName: "Nadia",
    userAvatar: null,
    text: "Could you review this?",
    isMention: true,
    linearIdentifier: null,
    linearIssueId: null,
    createdAt: "2026-07-25T10:00:00Z",
    ...overrides,
  };
}

function catchup(overrides: Partial<SlackCatchup> = {}): SlackCatchup {
  return {
    conversations: [],
    mentions: [],
    threads: [],
    lastSyncedAt: "2026-07-25T10:00:00Z",
    ...overrides,
  };
}

function input(overrides: Partial<DashboardInput> = {}): DashboardInput {
  return {
    issues: [],
    prs: [],
    notifications: [],
    slack: catchup(),
    viewerId: "viewer",
    today: "2026-07-26",
    ...overrides,
  };
}

describe("dashboardMetrics", () => {
  it("scopes overdue metrics to the active viewer and excludes today", () => {
    const metrics = dashboardMetrics(input({
      issues: [
        issue({ id: "mine-late", assigneeId: "viewer", dueDate: "2026-07-24" }),
        issue({ id: "mine-today", assigneeId: "viewer", dueDate: "2026-07-26" }),
        issue({ id: "other-late", assigneeId: "other", dueDate: "2026-07-20" }),
        issue({
          id: "done-late",
          assigneeId: "viewer",
          dueDate: "2026-07-20",
          stateType: "completed",
        }),
      ],
      prs: [
        pr({ id: "same", bucket: "needs_review" }),
        pr({ id: "same", bucket: "assigned" }),
      ],
      notifications: [
        notification({ id: "unread", read: false }),
        notification({ id: "read", read: true }),
      ],
      slack: catchup({ mentions: [message({ ts: "1" })] }),
    }));

    expect(metrics).toEqual({ overdue: 1, reviews: 1, inbox: 1, mentions: 1 });
  });

  it("returns zero Linear metrics until the cached viewer is known", () => {
    const metrics = dashboardMetrics(input({
      issues: [issue({ dueDate: "2026-07-20" })],
      viewerId: null,
    }));
    expect(metrics.overdue).toBe(0);
  });
});

describe("attentionItems", () => {
  it("deduplicates PR attention and keeps the highest urgency", () => {
    const items = attentionItems(input({
      prs: [
        pr({
          id: "pr-1",
          bucket: "mine",
          reviewDecision: "changes_requested",
          updatedAt: "2026-07-25T10:00:00Z",
        }),
        pr({
          id: "pr-1",
          bucket: "needs_review",
          updatedAt: "2026-07-26T10:00:00Z",
        }),
      ],
    }));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: "github",
      target: "prs",
      rank: 1,
      detail: "Changes requested",
    });
  });

  it("orders attention by urgency and caps the queue", () => {
    const items = attentionItems(input({
      issues: [
        issue({ id: "late-old", identifier: "GAM-10", dueDate: "2026-07-20" }),
        issue({ id: "late-new", identifier: "GAM-11", dueDate: "2026-07-24" }),
      ],
      prs: [
        pr({
          id: "critical",
          number: 10,
          bucket: "mine",
          reviewDecision: "changes_requested",
        }),
        pr({
          id: "review-old",
          number: 11,
          bucket: "needs_review",
          updatedAt: "2026-07-24T10:00:00Z",
        }),
        pr({
          id: "review-new",
          number: 12,
          bucket: "needs_review",
          updatedAt: "2026-07-25T10:00:00Z",
        }),
      ],
      slack: catchup({
        mentions: [message({ ts: "200.1", createdAt: "2026-07-25T12:00:00Z" })],
      }),
      notifications: [
        notification({ id: "inbox-1", createdAt: "2026-07-25T11:00:00Z" }),
        notification({ id: "inbox-2", createdAt: "2026-07-25T10:00:00Z" }),
        notification({ id: "inbox-3", createdAt: "2026-07-25T09:00:00Z" }),
      ],
    }), 8);

    expect(items).toHaveLength(8);
    expect(items.map((item) => item.rank)).toEqual([0, 0, 1, 2, 2, 3, 4, 4]);
    expect(items.slice(0, 2).map((item) => item.entityId)).toEqual(["late-old", "late-new"]);
    expect(items.filter((item) => item.rank === 2).map((item) => item.key)).toEqual([
      "github:review-new",
      "github:review-old",
    ]);
  });
});

describe("workloadBuckets", () => {
  it("returns every bucket, including zero counts", () => {
    const buckets = workloadBuckets([
      issue({ id: "started", assigneeId: "viewer", stateType: "started" }),
      issue({ id: "todo", assigneeId: "viewer", stateType: "unstarted" }),
      issue({ id: "other", assigneeId: "other", stateType: "backlog" }),
      issue({ id: "done", assigneeId: "viewer", stateType: "completed" }),
    ], "viewer");

    expect(buckets.map(({ key, count }) => ({ key, count }))).toEqual([
      { key: "started", count: 1 },
      { key: "unstarted", count: 1 },
      { key: "backlog", count: 0 },
    ]);
  });
});

describe("dueLoad", () => {
  it("builds seven exact dates and counts active viewer work", () => {
    const days = dueLoad([
      issue({ id: "today", assigneeId: "viewer", dueDate: "2026-07-26" }),
      issue({ id: "tomorrow", assigneeId: "viewer", dueDate: "2026-07-27" }),
      issue({
        id: "done-tomorrow",
        assigneeId: "viewer",
        dueDate: "2026-07-27",
        stateType: "completed",
      }),
      issue({ id: "other", assigneeId: "other", dueDate: "2026-07-27" }),
    ], "viewer", "2026-07-26");

    expect(days.map(({ date, count }) => ({ date, count }))).toEqual([
      { date: "2026-07-26", count: 1 },
      { date: "2026-07-27", count: 1 },
      { date: "2026-07-28", count: 0 },
      { date: "2026-07-29", count: 0 },
      { date: "2026-07-30", count: 0 },
      { date: "2026-07-31", count: 0 },
      { date: "2026-08-01", count: 0 },
    ]);
  });
});

describe("weekPreview", () => {
  it("previews overdue first, then this week by date and priority", () => {
    const preview = weekPreview([
      issue({
        id: "monday-low",
        identifier: "GAM-20",
        assigneeId: "viewer",
        dueDate: "2026-07-27",
        priority: 4,
      }),
      issue({
        id: "overdue",
        identifier: "GAM-21",
        assigneeId: "viewer",
        dueDate: "2026-07-25",
        priority: 1,
      }),
      issue({
        id: "monday-high",
        identifier: "GAM-22",
        assigneeId: "viewer",
        dueDate: "2026-07-27",
        priority: 1,
      }),
      issue({
        id: "next-week",
        identifier: "GAM-23",
        assigneeId: "viewer",
        dueDate: "2026-08-02",
      }),
    ], "viewer", "2026-07-26");

    expect(preview.map((item) => item.id)).toEqual([
      "overdue",
      "monday-high",
      "monday-low",
    ]);
  });
});
