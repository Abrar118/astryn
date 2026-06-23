// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GithubPr } from "@/lib/commands";

const hooks = vi.hoisted(() => ({
  useGithubStatus: vi.fn(),
  useGithubPrs: vi.fn(),
  useGithubSync: vi.fn(),
  useGithubContributions: vi.fn(),
  useGithubContributionsSync: vi.fn(),
}));
const setActiveView = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries", () => hooks);
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ setActiveView, openIssueTab: vi.fn() }) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { PrsPage } from "./PrsPage";

afterEach(() => { cleanup(); refetch.mockClear(); });

function pr(id: string, bucket: GithubPr["bucket"]): GithubPr {
  return {
    id, bucket, repo: "o/r", number: 1, title: "Add widget", draft: false, mergeable: "mergeable",
    ciStatus: "success", reviewDecision: null, authorLogin: "octocat", authorAvatar: null,
    commentCount: 0, branch: "b", baseBranch: "main", url: "https://x", linearIdentifier: null, linearIssueId: null,
    updatedAt: "2026-06-20T00:00:00Z", mergedAt: null, additions: 1, deletions: 0, changedFiles: 1,
    linearStateName: null, linearStateType: null, linearStateColor: null, linearPriority: null, reviewers: [],
  };
}

function setup(status: unknown, prs: GithubPr[] = [], meta: unknown[] = [], sync: unknown = {}) {
  hooks.useGithubStatus.mockReturnValue({ data: status });
  hooks.useGithubPrs.mockReturnValue({ data: { prs, meta } });
  hooks.useGithubSync.mockReturnValue({ data: undefined, isError: false, refetch, ...(sync as object) });
  hooks.useGithubContributions.mockReturnValue({ data: null });
  hooks.useGithubContributionsSync.mockReturnValue({ data: undefined });
}

describe("PrsPage", () => {
  it("shows a connect prompt when not configured", () => {
    setup({ state: "not_configured" });
    render(<PrsPage />);
    expect(screen.getByText(/connect github/i)).toBeInTheDocument();
  });

  it("renders the four section headings when connected", () => {
    setup({ state: "connected", login: "octocat" });
    render(<PrsPage />);
    expect(screen.getByText(/needs my review/i)).toBeInTheDocument();
    expect(screen.getByText(/my open prs/i)).toBeInTheDocument();
    expect(screen.getByText(/assigned to me/i)).toBeInTheDocument();
    expect(screen.getByText(/involved/i)).toBeInTheDocument();
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
    // Same PR title shown once under each of the two sections.
    expect(screen.getAllByText("Add widget")).toHaveLength(2);
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
    expect(screen.getByText(/couldn't refresh/i)).toBeInTheDocument();
  });
});
