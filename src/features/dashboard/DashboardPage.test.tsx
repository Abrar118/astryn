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
const moduleOn = vi.hoisted(() => ({ current: (_id: string): boolean => true }));
const screensOff = vi.hoisted(() => ({ current: [] as string[] }));

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
  kind: "github",
  name: "Product docs",
  owner: "gam",
  repo: "docs",
  branch: "main",
  location: null,
  url: "https://github.com/gam/docs",
  lastSyncedAt: "2026-07-25T09:00:00Z",
  fileCount: 42,
  truncated: false,
  available: true,
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

vi.mock("@/lib/taskQueries", () => ({
  useTasks: () => queryState.issues,
  useViewer: () => ({
    ids: {},
    viewerIds: queryState.me.data ? [queryState.me.data.viewerId] : [],
    name: queryState.me.data?.viewerName ?? null,
    isLoading: queryState.me.isLoading,
    isError: queryState.me.isError,
  }),
}));

vi.mock("@/lib/queries", () => ({
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

vi.mock("@/lib/modules", async (orig) => ({
  ...(await orig<typeof import("@/lib/modules")>()),
  useModules: () => ({ isActive: (id: string) => moduleOn.current(id), hasCapability: () => true, disabledScreens: screensOff.current, ready: true }),
}));
vi.mock("@/lib/tabs", () => ({
  useWorkspace: () => ({ setActiveView }),
}));

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), setParams],
}));

import { DashboardPage } from "./DashboardPage";

function setPopulatedFixtures() {
  queryState.connectionStatus = { data: { state: "connected", name: "Abrar" }, isLoading: false, isError: false };
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
  moduleOn.current = () => true;
  screensOff.current = [];
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const readout = (label: string) => screen.queryByRole("button", { name: new RegExp(`^${label}:`) });

describe("DashboardPage module gating", () => {
  it("shows the quiet empty state when no source module is on", () => {
    moduleOn.current = () => false;
    render(<DashboardPage />);
    expect(screen.getByText(/No modules are on/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(setActiveView).toHaveBeenCalledWith("settings");
    expect(readout("Overdue")).toBeNull();
  });

  it("drops the Inbox readout and items while the Inbox screen is off", () => {
    screensOff.current = ["inbox"];
    render(<DashboardPage />);
    expect(readout("Inbox")).toBeNull();
    expect(readout("Mentions")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Open inbox/ })).toBeNull();
    expect(useNotificationsCall).toHaveBeenCalledWith({ enabled: false });
  });

  it("shows one readout per active source and nothing for sources that are off", () => {
    const labels = () => within(screen.getByRole("list", { name: "Counts" }))
      .getAllByRole("button").map((b) => b.getAttribute("aria-label")?.split(":")[0]);
    const { unmount } = render(<DashboardPage />);
    expect(labels()).toEqual(["Reviews", "Inbox", "Mentions"]);
    unmount();
    screensOff.current = ["inbox"];
    moduleOn.current = (id) => id !== "slack";
    render(<DashboardPage />);
    expect(labels()).toEqual(["Reviews"]);
  });

  it("links Overdue to the first shown of This Week, Issues, Calendar", () => {
    screensOff.current = ["this-week"];
    const { unmount } = render(<DashboardPage />);
    fireEvent.click(readout("Overdue")!);
    expect(setActiveView).toHaveBeenLastCalledWith("list");
    unmount();
    screensOff.current = ["this-week", "list"];
    render(<DashboardPage />);
    fireEvent.click(readout("Overdue")!);
    expect(setActiveView).toHaveBeenLastCalledWith("calendar");
  });

  it("drops the readouts, dial and agenda of modules that are off", () => {
    moduleOn.current = (id) => id === "github";
    render(<DashboardPage />);
    expect(readout("Reviews")).toBeTruthy();
    for (const label of ["Overdue", "Inbox", "Mentions"]) expect(readout(label)).toBeNull();
    expect(screen.queryByRole("group", { name: "Due in the next 7 days" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "This week" })).toBeNull();
  });
});

describe("DashboardPage", () => {
  it("renders the date, counts and the attention queue", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T06:00:00Z"));
    render(<DashboardPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Sunday, July 26" })).toBeTruthy();
    expect(within(readout("Overdue")!).getByText("1")).toBeTruthy();
    const queue = screen.getByRole("list", { name: "Needs you" });
    expect(within(queue).getAllByText("GAM-101").length).toBeGreaterThan(0);
    expect(within(queue).getByText("Overdue since Jul 20")).toBeTruthy();
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
    const inbox = screen.getByRole("button", { name: "Inbox: not cached. Open inbox" });
    expect(within(inbox).getByText("—")).toBeTruthy();
  });

  it("offers setup instead of a zero when GitHub or Slack is not connected", () => {
    const github = queryState.githubStatus;
    const slackStatus = queryState.slackStatus;
    queryState.githubStatus = { data: { state: "not_configured" }, isLoading: false, isError: false } as never;
    queryState.slackStatus = { data: { state: "not_configured" }, isLoading: false, isError: false } as never;
    try {
      render(<DashboardPage />);
      const reviews = screen.getByRole("button", { name: "Reviews: not connected. Open pull requests" });
      expect(within(reviews).getByText("set up")).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Mentions: not connected/ })).toBeTruthy();
      fireEvent.click(reviews);
      expect(setActiveView).toHaveBeenCalledWith("settings");
    } finally {
      queryState.githubStatus = github;
      queryState.slackStatus = slackStatus;
    }
  });

  it("asks to set up Linear instead of showing an empty Inbox count", () => {
    queryState.connectionStatus = { data: { state: "not_configured" }, isLoading: false, isError: false };
    render(<DashboardPage />);
    const inbox = screen.getByRole("button", { name: "Inbox: not connected. Open inbox" });
    expect(within(inbox).getByText("set up")).toBeTruthy();
    fireEvent.click(inbox);
    expect(setActiveView).toHaveBeenCalledWith("settings");
  });

  it("draws the week as a dial with one stop per day", () => {
    render(<DashboardPage />);
    const dial = screen.getByRole("group", { name: "Due in the next 7 days" });
    expect(within(dial).getAllByRole("button")).toHaveLength(7);
    expect(within(dial).getByRole("button", { name: /^Today, / })).toBeTruthy();
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
    expect(within(readout("Overdue")!).getByText("0")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(within(readout("Overdue")!).getByText("1")).toBeTruthy();
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
    expect(within(readout("Overdue")!).getByText("—")).toBeTruthy();
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

  it("gives the queue one tab stop and moves through it with j / k", () => {
    render(<DashboardPage />);
    const rows = within(screen.getByRole("list", { name: "Needs you" })).getAllByRole("button");
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "j" });
    expect(document.activeElement).toBe(rows[1]);
    expect(rows[1].tabIndex).toBe(0);
    fireEvent.keyDown(rows[1], { key: "k" });
    expect(document.activeElement).toBe(rows[0]);
  });

  it("keeps overdue work out of the week agenda", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T06:00:00Z"));
    queryState.issues = {
      data: [issue(), issue({ id: "issue-102", identifier: "GAM-102", dueDate: "2026-07-28" })],
      isLoading: false,
      isError: false,
    };
    render(<DashboardPage />);
    expect(screen.getByRole("button", { name: "Open GAM-102 from this week" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open GAM-101 from this week" })).toBeNull();
  });

  it("navigates from the reviews readout to pull requests", () => {
    render(<DashboardPage />);
    fireEvent.click(readout("Reviews")!);
    expect(setActiveView).toHaveBeenCalledWith("prs");
  });

  it("keeps cached task content visible while Slack is loading", () => {
    queryState.slackCatchup = { data: undefined, isLoading: true, isError: false };
    render(<DashboardPage />);
    expect(screen.getAllByText("GAM-101").length).toBeGreaterThan(0);
    expect(within(readout("Mentions")!).getByText("—")).toBeTruthy();
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
