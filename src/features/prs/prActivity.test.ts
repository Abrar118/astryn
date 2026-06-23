import { describe, expect, it } from "vitest";
import type { Contributions, GithubPr } from "@/lib/commands";
import { contributionsToWeeks, prStats } from "./prActivity";

function pr(over: Partial<GithubPr> & Pick<GithubPr, "id" | "bucket">): GithubPr {
  return {
    repo: "o/r", number: 1, title: "t", draft: false, mergeable: "mergeable",
    ciStatus: "success", reviewDecision: null, authorLogin: "octocat", authorAvatar: null,
    commentCount: 0, branch: "b", baseBranch: "main", url: "u", linearIdentifier: null, linearIssueId: null,
    updatedAt: "2026-06-18T10:00:00Z", mergedAt: null, additions: 1, deletions: 0, changedFiles: 1,
    linearStateName: null, linearStateType: null, linearStateColor: null, linearPriority: null, reviewers: [],
    ...over,
  };
}

describe("contributionsToWeeks", () => {
  it("returns empty for null contributions", () => {
    expect(contributionsToWeeks(null)).toEqual([]);
  });

  it("pads each week to 7 cells, placing days by weekday", () => {
    const contributions: Contributions = {
      total: 5,
      weeks: [
        // Partial first week: only Tue(2) and Wed(3) present.
        [
          { date: "2025-06-03", count: 2, weekday: 2 },
          { date: "2025-06-04", count: 3, weekday: 3 },
        ],
      ],
    };
    const weeks = contributionsToWeeks(contributions);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].cells).toHaveLength(7);
    // Sun(0)/Mon(1) padded empty; Tue(2)/Wed(3) carry data.
    expect(weeks[0].cells[0]).toEqual({ date: "", count: 0 });
    expect(weeks[0].cells[2]).toEqual({ date: "2025-06-03", count: 2 });
    expect(weeks[0].cells[3]).toEqual({ date: "2025-06-04", count: 3 });
  });
});

describe("prStats", () => {
  it("counts open (deduped), needs-review, changes-requested, and conflicts", () => {
    const prs = [
      pr({ id: "o/r#1", bucket: "needs_review" }),
      pr({ id: "o/r#2", bucket: "mine", reviewDecision: "changes_requested" }),
      pr({ id: "o/r#2", bucket: "assigned" }), // same PR, second bucket
      pr({ id: "o/r#3", bucket: "involved", mergeable: "conflicting" }),
    ];
    expect(prStats(prs)).toEqual({
      open: 3, // #1, #2, #3 distinct
      needsReview: 1,
      changesRequested: 1,
      conflicts: 1,
    });
  });
});
