// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { GithubPr, GithubPrDetail } from "@/lib/commands";
import { PrDrawerOverview } from "./PrDrawerOverview";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
afterEach(cleanup);

const seed = {
  repo: "Acme/Web",
  number: 42,
  title: "Make review faster",
  mergeable: "mergeable",
  reviewDecision: "approved",
  ciStatus: "success",
  additions: 8,
  deletions: 2,
  changedFiles: 2,
  reviewers: [{ login: "lee", avatar: null, state: "approved" }],
  linearIdentifier: "ENG-42",
} as GithubPr;

const detail = {
  body: "## Summary\n\nShip it.\n\n<script>unsafe()</script>",
  authorLogin: "alex",
  authorAvatar: null,
  createdAt: "2026-07-25T10:00:00Z",
  state: "open",
  draft: false,
  mergeable: "mergeable",
  reviewDecision: "approved",
  changedFiles: 2,
  linearIdentifier: "ENG-42",
  comments: [
    {
      id: "c",
      body: "Comment body",
      createdAt: "2026-07-25T12:03:00Z",
      url: "https://x/c",
      authorLogin: "sam",
      authorAvatar: null,
    },
  ],
  reviews: [
    {
      id: "r",
      body: "",
      state: "approved",
      submittedAt: "2026-07-25T12:02:00Z",
      url: "https://x/r",
      authorLogin: "lee",
      authorAvatar: null,
    },
  ],
  commits: [
    {
      oid: "abc123",
      headline: "Initial commit",
      committedAt: "2026-07-25T12:01:00Z",
      url: "https://x/k",
      authorName: "Alex",
      authorLogin: "alex",
      authorAvatar: null,
    },
  ],
  checks: [
    {
      name: "test",
      status: "completed",
      conclusion: "success",
      detailsUrl: "https://x/check",
    },
  ],
  truncated: {
    comments: false,
    reviews: false,
    commits: false,
    files: false,
    checks: false,
  },
} as GithubPrDetail;

describe("PrDrawerOverview", () => {
  it("renders safe Markdown, activity in order, and metadata", () => {
    render(<PrDrawerOverview seed={seed} detail={detail} />);
    expect(screen.getByRole("heading", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByText("Ship it.")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    const activity = screen.getByLabelText("Pull request activity");
    const text = within(activity).getAllByRole("article").map((item) => item.textContent);
    expect(text[0]).toContain("Initial commit");
    expect(text[1]).toContain("Approved");
    expect(text[2]).toContain("Comment body");
    expect(screen.getByText("test")).toBeInTheDocument();
    expect(screen.getByText("ENG-42")).toBeInTheDocument();
  });

  it("uses calm cached-only empty states", () => {
    render(<PrDrawerOverview seed={seed} detail={undefined} />);
    expect(screen.getByText(/live description is unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/activity loads with live details/i)).toBeInTheDocument();
  });

  it("merges live review authors with cached reviewers", () => {
    render(
      <PrDrawerOverview
        seed={seed}
        detail={{
          ...detail,
          comments: [],
          commits: [],
          reviews: [
            {
              ...detail.reviews[0],
              id: "live-review",
              authorLogin: "live-reviewer",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("lee, live-reviewer")).toBeInTheDocument();
  });
});
