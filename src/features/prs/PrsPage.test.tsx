// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GithubPr } from "@/lib/commands";

const hooks = vi.hoisted(() => ({
  useGithubStatus: vi.fn(),
  useGithubPrs: vi.fn(),
  useGithubSync: vi.fn(),
  useGithubContributions: vi.fn(),
  useGithubContributionsSync: vi.fn(),
  useGithubPrDetail: vi.fn(),
  useGithubPrDiff: vi.fn(),
  useSetGithubRepoFavorite: vi.fn(),
}));
const setActiveView = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries", () => hooks);
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ setActiveView, openIssueTab: vi.fn() }) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { PrsPage } from "./PrsPage";

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); refetch.mockClear(); });

function pr(
  id: string,
  bucket: GithubPr["bucket"],
  over: Partial<GithubPr> = {},
): GithubPr {
  return {
    id, bucket, repo: "o/r", number: 1, title: "Add widget", draft: false, mergeable: "mergeable",
    ciStatus: "success", reviewDecision: null, authorLogin: "octocat", authorAvatar: null,
    commentCount: 0, branch: "b", baseBranch: "main", url: "https://x", linearIdentifier: null, linearIssueId: null,
    updatedAt: "2026-06-20T00:00:00Z", mergedAt: null, additions: 1, deletions: 0, changedFiles: 1,
    linearStateName: null, linearStateType: null, linearStateColor: null, linearPriority: null, reviewers: [],
    ...over,
  };
}

function setup(
  status: unknown,
  prs: GithubPr[] = [],
  meta: unknown[] = [],
  sync: unknown = {},
  favoriteRepos: string[] = [],
) {
  hooks.useGithubStatus.mockReturnValue({ data: status });
  hooks.useGithubPrs.mockReturnValue({ data: { prs, meta, favoriteRepos } });
  hooks.useGithubSync.mockReturnValue({ data: undefined, isError: false, refetch, ...(sync as object) });
  hooks.useGithubContributions.mockReturnValue({ data: null });
  hooks.useGithubContributionsSync.mockReturnValue({ data: undefined });
  hooks.useGithubPrDetail.mockReturnValue({
    data: undefined,
    isLoading: true,
    isError: false,
    refetch: vi.fn(),
  });
  hooks.useGithubPrDiff.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  hooks.useSetGithubRepoFavorite.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue([]),
  });
}

describe("PrsPage", () => {
  it("shows a connect prompt when not configured", () => {
    setup({ state: "not_configured" });
    render(<PrsPage />);
    expect(screen.getByText(/connect github/i)).toBeInTheDocument();
  });

  it("renders the three actionable queues and omits involved", () => {
    setup({ state: "connected", login: "octocat" });
    render(<PrsPage />);
    expect(screen.getByRole("button", { name: /my prs/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /assigned to me/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /needs my review/i })).toBeInTheDocument();
    expect(screen.queryByText(/involved/i)).toBeNull();
  });

  it("manual refresh triggers a sync refetch", () => {
    setup({ state: "connected", login: "octocat" });
    render(<PrsPage />);
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("renders a PR in every bucket it legitimately belongs to", () => {
    setup({ state: "connected", login: "octocat" }, [pr("o/r#1", "needs_review"), pr("o/r#1", "mine")]);
    render(<PrsPage />);
    expect(screen.getAllByText("Add widget")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /needs my review/i }));
    expect(screen.getAllByText("Add widget")).toHaveLength(1);
  });

  it("shows a per-section truncation note from sync meta", () => {
    setup(
      { state: "connected", login: "octocat" },
      [],
      [{ bucket: "mine", fetchedCount: 142, truncated: true, lastSyncedAt: null }],
    );
    render(<PrsPage />);
    expect(screen.getByText(/142 most recent/i)).toBeInTheDocument();
  });

  it("flags a section that failed to refresh", () => {
    setup(
      { state: "connected", login: "octocat" },
      [],
      [],
      { data: [{ bucket: "needs_review", ok: false, truncated: false }] },
    );
    render(<PrsPage />);
    fireEvent.click(screen.getByRole("button", { name: /needs my review/i }));
    expect(screen.getByText(/couldn't refresh/i)).toBeInTheDocument();
  });

  it("shows one active queue at a time and switches from My PRs", () => {
    setup(
      { state: "connected", login: "octocat" },
      [
        pr("o/r#1", "mine", { title: "Mine title" }),
        pr("o/r#2", "assigned", { title: "Assigned title" }),
      ],
    );
    render(<PrsPage />);
    expect(screen.getByText("Mine title")).toBeInTheDocument();
    expect(screen.queryByText("Assigned title")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /assigned to me/i }));
    expect(screen.getByText("Assigned title")).toBeInTheDocument();
    expect(screen.queryByText("Mine title")).toBeNull();
  });

  it("selects a favorite repository and shows all rows in its repository scope", () => {
    setup(
      { state: "connected", login: "octocat" },
      [
        pr("acme/web#1", "repo:acme/web", { repo: "Acme/Web", title: "Repo one" }),
        pr("acme/web#2", "repo:acme/web", { repo: "Acme/Web", title: "Repo two" }),
        pr("acme/web#3", "mine", { repo: "Acme/Web", title: "Viewer copy" }),
      ],
      [],
      {},
      ["Acme/Web"],
    );
    render(<PrsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Acme/Web" }));
    expect(screen.getByText("Repo one")).toBeInTheDocument();
    expect(screen.getByText("Repo two")).toBeInTheDocument();
    expect(screen.queryByText("Viewer copy")).toBeNull();
  });

  it("defaults grouping on and persists an explicit off preference", () => {
    setup({ state: "connected", login: "octocat" });
    render(<PrsPage />);
    const group = screen.getByRole("button", { name: /group by repository/i });
    expect(group).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(group);
    expect(localStorage.getItem("astryn:prs:group-by-repo:v1")).toBe("false");
  });

  it("opens and closes the pull request drawer from a row", () => {
    setup({ state: "connected", login: "octocat" }, [pr("o/r#1", "mine")]);
    render(<PrsPage />);
    fireEvent.click(
      screen.getByRole("button", { name: /Add widget pull request/i }),
    );
    expect(
      screen.getByRole("dialog", { name: /o\/r pull request 1/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close pull request" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
