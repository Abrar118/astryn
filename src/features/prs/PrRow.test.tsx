// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GithubPr } from "@/lib/commands";

const openIssueTab = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ openIssueTab }) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { PrRow } from "./PrRow";

const base: GithubPr = {
  id: "o/r#42", bucket: "mine", repo: "o/r", number: 42, title: "Add widget", draft: false,
  mergeable: "mergeable", ciStatus: "success", reviewDecision: "changes_requested",
  authorLogin: "octocat", authorAvatar: "https://a/x.png", commentCount: 3, branch: "eng-9", baseBranch: "main",
  url: "https://x", linearIdentifier: "ENG-9", linearIssueId: "iss-1", updatedAt: "2026-06-20T00:00:00Z",
};

afterEach(cleanup);

describe("PrRow", () => {
  it("shows core fields, avatar, relative time, and changes-requested badge", () => {
    render(<PrRow pr={base} />);
    expect(screen.getByText("Add widget")).toBeInTheDocument();
    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("octocat")).toBeInTheDocument();
    expect(screen.getByText("o/r")).toBeInTheDocument();
    expect(screen.getByText(/changes requested/i)).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://a/x.png");
    expect(screen.getByTestId("pr-updated").textContent).not.toBe("");
  });

  it("opens the linked Linear issue when the chip is clicked", () => {
    render(<PrRow pr={base} />);
    fireEvent.click(screen.getByRole("button", { name: /ENG-9/ }));
    expect(openIssueTab).toHaveBeenCalledWith("iss-1");
  });

  it("renders no Linear chip without a matched issue id", () => {
    render(<PrRow pr={{ ...base, linearIssueId: null }} />);
    expect(screen.queryByRole("button", { name: /ENG-9/ })).toBeNull();
  });

  it("shows a conflict badge only when conflicting", () => {
    const { rerender } = render(<PrRow pr={{ ...base, mergeable: "conflicting" }} />);
    expect(screen.getByText(/conflict/i)).toBeInTheDocument();
    rerender(<PrRow pr={{ ...base, mergeable: "mergeable" }} />);
    expect(screen.queryByText(/conflict/i)).toBeNull();
  });

  it("shows explicit open vs draft status", () => {
    const { rerender } = render(<PrRow pr={base} />);
    expect(screen.getByText("Open")).toBeInTheDocument();
    rerender(<PrRow pr={{ ...base, draft: true }} />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it.each([
    ["success", "CI passing"],
    ["failure", "CI failing"],
    ["pending", "CI pending"],
  ] as const)("renders a CI badge for %s", (ci, label) => {
    render(<PrRow pr={{ ...base, ciStatus: ci }} />);
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it.each(["none", null] as const)("renders no CI badge for %s", (ci) => {
    render(<PrRow pr={{ ...base, ciStatus: ci }} />);
    expect(screen.queryByLabelText(/^CI /)).toBeNull();
  });

  it.each([
    ["approved", /approved/i],
    ["changes_requested", /changes requested/i],
    ["review_required", /review required/i],
  ] as const)("renders the %s review label", (decision, re) => {
    render(<PrRow pr={{ ...base, reviewDecision: decision }} />);
    expect(screen.getByText(re)).toBeInTheDocument();
  });

  it("renders no review label when null", () => {
    render(<PrRow pr={{ ...base, reviewDecision: null }} />);
    expect(screen.queryByText(/approved|changes requested|review required/i)).toBeNull();
  });
});
