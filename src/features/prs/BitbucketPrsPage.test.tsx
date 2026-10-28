// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GithubPr } from "@/lib/commands";

const hooks = vi.hoisted(() => ({
  useBitbucketStatus: vi.fn(),
  useBitbucketPrs: vi.fn(),
  useBitbucketSync: vi.fn(),
  useBitbucketRepositories: vi.fn(),
  useBitbucketPrDetail: vi.fn(),
  useBitbucketPrDiff: vi.fn(),
  useSetBitbucketRepoFavorite: vi.fn(),
}));
const setActiveView = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bitbucketQueries", () => hooks);
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ setActiveView, openIssueTab: vi.fn() }) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { takeRequestedSection } from "@/features/settings/settingsSection";
import { BITBUCKET_HOST } from "./bitbucketHost";
import { PrsPage } from "./PrsPage";

afterEach(() => cleanup());

function pr(id: string, bucket: GithubPr["bucket"], over: Partial<GithubPr> = {}): GithubPr {
  return {
    id, bucket, repo: "acme/api", number: 7, title: "Add widget", draft: false, mergeable: "unknown",
    ciStatus: "none", reviewDecision: null, authorLogin: "me", authorAvatar: null,
    commentCount: 0, branch: "feature", baseBranch: "main",
    url: "https://bitbucket.org/acme/api/pull-requests/7", linearIdentifier: null, linearIssueId: null,
    updatedAt: "2026-10-27T10:00:00.123456+00:00", mergedAt: null, additions: null, deletions: null,
    changedFiles: null, linearStateName: null, linearStateType: null, linearStateColor: null,
    linearPriority: null, reviewers: [],
    ...over,
  };
}

function setup(status: unknown, prs: GithubPr[] = []) {
  hooks.useBitbucketStatus.mockReturnValue({ data: status });
  hooks.useBitbucketPrs.mockReturnValue({ data: { prs, meta: [], favoriteRepos: [] } });
  hooks.useBitbucketSync.mockReturnValue({ data: undefined, isError: false, refetch: vi.fn() });
  hooks.useBitbucketRepositories.mockReturnValue({
    data: { repositories: [], truncated: false }, isLoading: false, isError: false, refetch: vi.fn(),
  });
  hooks.useBitbucketPrDetail.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
  hooks.useBitbucketPrDiff.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() });
  hooks.useSetBitbucketRepoFavorite.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue([]) });
}

describe("PrsPage with the Bitbucket host", () => {
  it("prompts to connect Bitbucket and deep-links to its settings", () => {
    setup({ state: "not_configured" });
    render(<PrsPage host={BITBUCKET_HOST} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Bitbucket" }));
    expect(takeRequestedSection()).toBe("bitbucket");
    expect(setActiveView).toHaveBeenCalledWith("settings");
  });

  it("shows only Bitbucket's queues and no contribution heatmap", () => {
    setup({ state: "connected", login: "me" }, [pr("acme/api#7", "mine")]);
    render(<PrsPage host={BITBUCKET_HOST} />);
    expect(screen.getByRole("heading", { name: "Bitbucket Pull Requests" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /my prs/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /needs my review/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /assigned to me/i })).toBeNull();
    expect(screen.queryByText(/contributions · last year/i)).toBeNull();
    expect(screen.getByText("Add widget")).toBeInTheDocument();
    expect(hooks.useBitbucketSync).toHaveBeenCalledWith(true);
  });

  it("explains that Needs My Review comes from favorite repositories", () => {
    setup({ state: "connected", login: "me" });
    render(<PrsPage host={BITBUCKET_HOST} />);
    fireEvent.click(screen.getByRole("button", { name: /needs my review/i }));
    expect(screen.getByText(/favorite a repository to include it/i)).toBeInTheDocument();
  });

  it("opens the drawer with Bitbucket's detail hook and copy", () => {
    setup({ state: "connected", login: "me" }, [pr("acme/api#7", "mine")]);
    render(<PrsPage host={BITBUCKET_HOST} />);
    fireEvent.click(screen.getByRole("button", { name: /Add widget pull request/i }));
    expect(hooks.useBitbucketPrDetail).toHaveBeenCalledWith("acme/api", 7);
    expect(hooks.useBitbucketPrDiff).toHaveBeenCalledWith("acme/api", 7, false);
    expect(screen.getByRole("button", { name: "Open pull request on Bitbucket" })).toBeInTheDocument();
  });
});
