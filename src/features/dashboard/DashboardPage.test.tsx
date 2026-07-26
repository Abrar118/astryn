// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type {
  DocsSource,
  GithubPr,
  IssueListItem,
  Notification,
  SlackCatchup,
} from "@/lib/commands";

const setActiveView = vi.hoisted(() => vi.fn());
const setParams = vi.hoisted(() => vi.fn());
const useNotificationsCall = vi.hoisted(() => vi.fn());

function issue(overrides: Partial<IssueListItem> = {}): IssueListItem {
  return {
    id: "issue-101",
    identifier: "GAM-101",
    title: "Finalize onboarding flow",
    description: null,
    dueDate: "2020-07-20",
    startedAt: null,
    priority: 1,
    url: "https://linear.app/issue/GAM-101",
    stateId: "state-1",
    stateName: "In Progress",
    stateType: "started",
    stateColor: "#818cf8",
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
    prCount: 1,
    attachmentsTruncated: false,
    createdAt: "2026-07-20T10:00:00Z",
    updatedAt: "2026-07-25T10:00:00Z",
    labels: [],
    ...overrides,
  };
}

function pr(overrides: Partial<GithubPr> = {}): GithubPr {
  return {
    id: "gam/app#218",
    bucket: "needs_review",
    repo: "gam/app",
    number: 218,
    title: "Billing retry policy",
    draft: false,
    mergeable: "mergeable",
    ciStatus: "success",
    reviewDecision: "review_required",
    authorLogin: "rafi",
    authorAvatar: null,
    commentCount: 2,
    branch: "gam-101",
    baseBranch: "main",
    url: "https://github.com/gam/app/pull/218",
    linearIdentifier: "GAM-101",
    linearIssueId: "issue-101",
    updatedAt: "2026-07-25T10:00:00Z",
    mergedAt: null,
    additions: 20,
    deletions: 3,
    changedFiles: 2,
    linearStateName: "In Progress",
    linearStateType: "started",
    linearStateColor: "#818cf8",
    linearPriority: 1,
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
    issueId: "issue-101",
    issueIdentifier: "GAM-101",
    issueTitle: "Finalize onboarding flow",
    issueStateType: "started",
    issueStateColor: "#818cf8",
    issueProjectName: null,
    ...overrides,
  };
}

const catchup: SlackCatchup = {
  conversations: [{
    id: "dm-1",
    kind: "dm",
    name: "Nadia",
    partnerUserId: "user-1",
    unreadCount: 2,
    hasMention: true,
    unreadThreads: 1,
    latestTs: "100.1",
    latestSnippet: "Can you review this?",
  }],
  mentions: [{
    conversationId: "dm-1",
    ts: "100.1",
    threadTs: null,
    userId: "user-1",
    userName: "Nadia",
    userAvatar: null,
    text: "Can you review this?",
    isMention: true,
    linearIdentifier: "GAM-101",
    linearIssueId: "issue-101",
    createdAt: "2026-07-25T10:00:00Z",
  }],
  threads: [{
    conversationId: "dm-1",
    conversationName: "Nadia",
    threadTs: "100.0",
    unreadReplies: 1,
    hasMention: true,
    latestTs: "100.1",
  }],
  lastSyncedAt: "2026-07-25T10:00:00Z",
};

const docsSource: DocsSource = {
  id: "gam/docs@main",
  name: "Product docs",
  owner: "gam",
  repo: "docs",
  branch: "main",
  url: "https://github.com/gam/docs",
  lastSyncedAt: "2026-07-25T09:00:00Z",
  fileCount: 42,
  truncated: false,
};

const queryState = vi.hoisted(() => ({
  issues: {
    data: [] as IssueListItem[] | undefined,
    isLoading: false,
    isError: false,
  },
  me: {
    data: { viewerId: "viewer", viewerName: "Abrar" } as {
      viewerId: string;
      viewerName: string;
    } | null | undefined,
    isLoading: false,
    isError: false,
  },
  connectionStatus: {
    data: { state: "connected", name: "Abrar" } as
      | { state: "connected"; name: string }
      | { state: "unverified" }
      | { state: "not_configured" }
      | undefined,
    isLoading: false,
    isError: false,
  },
  notifications: {
    data: { notifications: [] as Notification[], hasMore: false } as {
      notifications: Notification[];
      hasMore: boolean;
    } | undefined,
    isLoading: false,
    isError: false,
  },
  githubStatus: {
    data: { state: "connected", login: "abrar" } as const,
    isLoading: false,
    isError: false,
  },
  githubPrs: {
    data: { prs: [] as GithubPr[], meta: [] } as {
      prs: GithubPr[];
      meta: { lastSyncedAt: string | null }[];
    } | undefined,
    isLoading: false,
    isError: false,
  },
  slackStatus: {
    data: { state: "connected", workspaceName: "GAM", userName: "Abrar" } as const,
    isLoading: false,
    isError: false,
  },
  slackCatchup: {
    data: undefined as SlackCatchup | undefined,
    isLoading: false,
    isError: false,
  },
  docsStatus: {
    data: { tokenPresent: true, sourceCount: 1 },
    isLoading: false,
    isError: false,
  },
  docsSources: {
    data: [] as DocsSource[] | undefined,
    isLoading: false,
    isError: false,
  },
}));

vi.mock("@/lib/queries", () => ({
  useIssues: () => queryState.issues,
  useMe: () => queryState.me,
  useConnectionStatus: () => queryState.connectionStatus,
  useNotifications: (options?: unknown) => {
    useNotificationsCall(options);
    return queryState.notifications;
  },
  useGithubStatus: () => queryState.githubStatus,
  useGithubPrs: () => queryState.githubPrs,
  useSlackStatus: () => queryState.slackStatus,
  useSlackCatchup: () => queryState.slackCatchup,
  useDocsStatus: () => queryState.docsStatus,
  useDocsSources: () => queryState.docsSources,
}));

vi.mock("@/lib/tabs", () => ({
  useWorkspace: () => ({ setActiveView }),
}));

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), setParams],
}));

import { DashboardPage } from "./DashboardPage";

function setPopulatedFixtures() {
  queryState.issues = { data: [issue()], isLoading: false, isError: false };
  queryState.me = {
    data: { viewerId: "viewer", viewerName: "Abrar" },
    isLoading: false,
    isError: false,
  };
  queryState.notifications = {
    data: { notifications: [notification()], hasMore: false },
    isLoading: false,
    isError: false,
  };
  queryState.githubPrs = {
    data: { prs: [pr()], meta: [] },
    isLoading: false,
    isError: false,
  };
  queryState.slackCatchup = { data: catchup, isLoading: false, isError: false };
  queryState.docsSources = { data: [docsSource], isLoading: false, isError: false };
}

beforeEach(() => {
  setPopulatedFixtures();
  setActiveView.mockReset();
  setParams.mockReset();
  useNotificationsCall.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("DashboardPage", () => {
  it("renders cached metrics and the attention queue", () => {
    render(<DashboardPage />);
    expect(screen.getByRole("heading", { name: /Abrar/i })).toBeTruthy();
    expect(screen.getByText("Overdue")).toBeTruthy();
    expect(screen.getAllByText("GAM-101").length).toBeGreaterThan(0);
    expect(screen.getByRole("table", { name: "Needs your attention" })).toBeTruthy();
  });

  it("observes notifications without starting their live provider request", () => {
    render(<DashboardPage />);
    expect(useNotificationsCall).toHaveBeenCalledWith({ enabled: false });
  });

  it("shows Inbox as not cached instead of reporting a false zero", () => {
    queryState.notifications = {
      data: undefined,
      isLoading: false,
      isError: false,
    };
    render(<DashboardPage />);
    const inboxCard = screen.getByRole("button", { name: "Open inbox" });
    expect(within(inboxCard).getByText("—")).toBeTruthy();
    expect(within(inboxCard).getByText("Open Inbox to read")).toBeTruthy();
  });

  it("uses pane container layouts instead of viewport breakpoint grids", () => {
    render(<DashboardPage />);
    expect(document.querySelector(".dashboard-kpi-grid")).toBeTruthy();
    expect(document.querySelector(".dashboard-main-grid")).toBeTruthy();
    expect(document.querySelector(".dashboard-lower-grid")).toBeTruthy();
  });

  it("recalculates Dhaka date metrics after midnight while mounted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T17:59:30Z"));
    queryState.issues = {
      data: [issue({ dueDate: "2026-07-26" })],
      isLoading: false,
      isError: false,
    };

    render(<DashboardPage />);
    const overdueCard = screen.getByRole("button", { name: "Open overdue issues" });
    expect(within(overdueCard).getByText("0")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(within(overdueCard).getByText("1")).toBeTruthy();
    expect(screen.getByText(/Monday, July 27/)).toBeTruthy();
  });

  it("does not turn an unavailable uncached source into zero or a calm queue", () => {
    queryState.issues = { data: undefined, isLoading: false, isError: true };
    queryState.notifications = {
      data: { notifications: [], hasMore: false },
      isLoading: false,
      isError: false,
    };
    queryState.githubPrs = {
      data: { prs: [], meta: [] },
      isLoading: false,
      isError: false,
    };
    queryState.slackCatchup = {
      data: { conversations: [], mentions: [], threads: [], lastSyncedAt: null },
      isLoading: false,
      isError: false,
    };

    render(<DashboardPage />);
    const overdueCard = screen.getByRole("button", { name: "Open overdue issues" });
    expect(within(overdueCard).getByText("—")).toBeTruthy();
    expect(screen.getByText("Some caches are unavailable")).toBeTruthy();
    expect(screen.queryByText("Nothing urgent right now")).toBeNull();
  });

  it("uses the local Linear connection state instead of inferring setup from viewer cache", () => {
    queryState.connectionStatus = {
      data: { state: "unverified" },
      isLoading: false,
      isError: false,
    };
    queryState.me = { data: null, isLoading: false, isError: false };

    render(<DashboardPage />);
    expect(screen.getByRole("button", {
      name: /Linear Cached: Connection not verified/i,
    })).toBeTruthy();
  });

  it("opens a Linear attention item in the issue drawer", () => {
    render(<DashboardPage />);
    fireEvent.click(screen.getByRole("button", { name: "Open GAM-101" }));
    expect(setParams).toHaveBeenCalledWith({ issue: "issue-101" });
  });

  it("navigates from the reviews card to pull requests", () => {
    render(<DashboardPage />);
    fireEvent.click(screen.getByRole("button", { name: "Open pull requests" }));
    expect(setActiveView).toHaveBeenCalledWith("prs");
  });

  it("keeps cached Linear content visible while Slack is loading", () => {
    queryState.slackCatchup = { data: undefined, isLoading: true, isError: false };
    render(<DashboardPage />);
    expect(screen.getAllByText("GAM-101").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Reading cache…").length).toBeGreaterThan(0);
  });

  it("renders a calm empty attention state", () => {
    queryState.issues = { data: [], isLoading: false, isError: false };
    queryState.notifications = {
      data: { notifications: [], hasMore: false },
      isLoading: false,
      isError: false,
    };
    queryState.githubPrs = {
      data: { prs: [], meta: [] },
      isLoading: false,
      isError: false,
    };
    queryState.slackCatchup = { data: {
      conversations: [],
      mentions: [],
      threads: [],
      lastSyncedAt: null,
    }, isLoading: false, isError: false };

    render(<DashboardPage />);
    expect(screen.getByText("Nothing urgent right now")).toBeTruthy();
  });

  it("does not claim the attention queue is empty while caches are loading", () => {
    queryState.issues = { data: [], isLoading: true, isError: false };
    queryState.notifications = {
      data: { notifications: [], hasMore: false },
      isLoading: true,
      isError: false,
    };
    queryState.githubPrs = {
      data: { prs: [], meta: [] },
      isLoading: true,
      isError: false,
    };
    queryState.slackCatchup = { data: undefined, isLoading: true, isError: false };

    render(<DashboardPage />);
    expect(screen.getByText("Reading cached attention…")).toBeTruthy();
    expect(screen.queryByText("Nothing urgent right now")).toBeNull();
  });

  it("marks a provider source unavailable when its cached read fails", () => {
    queryState.githubPrs = {
      data: { prs: [], meta: [] },
      isLoading: false,
      isError: true,
    };
    render(<DashboardPage />);
    expect(screen.getByRole("button", { name: /GitHub Unavailable/i })).toBeTruthy();
  });
});
