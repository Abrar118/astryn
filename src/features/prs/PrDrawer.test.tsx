// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GithubPr, GithubPrDetail } from "@/lib/commands";

const detailHook = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries", () => ({ useGithubPrDetail: detailHook }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));

import { PrDrawer } from "./PrDrawer";

const seed = {
  id: "acme/web#42",
  bucket: "mine",
  repo: "Acme/Web",
  number: 42,
  title: "Make review faster",
  draft: false,
  mergeable: "mergeable",
  ciStatus: "success",
  reviewDecision: "approved",
  authorLogin: "alex",
  authorAvatar: null,
  commentCount: 1,
  branch: "feature/review",
  baseBranch: "main",
  url: "https://github.com/acme/web/pull/42",
  linearIdentifier: "ENG-42",
  linearIssueId: null,
  updatedAt: "2026-07-26T12:00:00Z",
  mergedAt: null,
  additions: 10,
  deletions: 2,
  changedFiles: 1,
  linearStateName: null,
  linearStateType: null,
  linearStateColor: null,
  linearPriority: null,
  reviewers: [],
} satisfies GithubPr;

const detail = {
  repo: seed.repo,
  number: seed.number,
  title: seed.title,
  url: seed.url,
  state: "open",
  draft: false,
  mergeable: "mergeable",
  reviewDecision: "approved",
  body: "## Summary\n\nFaster reviews.",
  createdAt: "2026-07-25T12:00:00Z",
  updatedAt: seed.updatedAt,
  authorLogin: "alex",
  authorAvatar: null,
  headBranch: seed.branch,
  baseBranch: seed.baseBranch,
  additions: 10,
  deletions: 2,
  changedFiles: 1,
  commentCount: 1,
  linearIdentifier: "ENG-42",
  comments: [],
  reviews: [],
  commits: [],
  files: [{ path: "src/review.ts", changeType: "modified", additions: 10, deletions: 2 }],
  checks: [],
  truncated: {
    comments: false,
    reviews: false,
    commits: false,
    files: false,
    checks: false,
  },
} satisfies GithubPrDetail;

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDrawer(overrides: Partial<React.ComponentProps<typeof PrDrawer>> = {}) {
  const onClose = vi.fn();
  render(
    <PrDrawer
      pr={seed}
      favorite={false}
      onFavoriteChange={vi.fn()}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onClose };
}

describe("PrDrawer", () => {
  it("renders cached metadata while live detail is loading", () => {
    detailHook.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
    renderDrawer();
    expect(screen.getByText("Make review faster")).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: /loading pull request details/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close pull request" })).toHaveFocus();
  });

  it("keeps cached content and offers retry after a detail error", () => {
    const refetch = vi.fn();
    detailHook.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    renderDrawer();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /couldn't load live details/i,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("switches between Overview and Changes", () => {
    detailHook.mockReturnValue({
      data: detail,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderDrawer();
    expect(screen.getByRole("heading", { name: "Summary" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /changes/i }));
    expect(screen.getByText("src/review.ts")).toBeInTheDocument();
  });

  it("closes on Escape and restores focus", () => {
    detailHook.mockReturnValue({
      data: detail,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    const origin = document.createElement("button");
    document.body.appendChild(origin);
    const { onClose } = renderDrawer({ returnFocus: origin });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(origin).toHaveFocus();
    origin.remove();
  });

  it("resizes and persists its clamped width", () => {
    detailHook.mockReturnValue({
      data: detail,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderDrawer();
    const separator = screen.getByRole("separator", {
      name: /resize pull request drawer/i,
    });
    fireEvent.pointerDown(separator, { clientX: 432 });
    fireEvent.pointerMove(window, { clientX: 500 });
    fireEvent.pointerUp(window);
    expect(localStorage.getItem("astryn:prs:drawer-width:v1")).toBe("940");
  });
});
