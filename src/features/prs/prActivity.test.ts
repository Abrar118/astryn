import { describe, expect, it } from "vitest";
import type { GithubPr } from "@/lib/commands";
import { buildPrHeatmap, prStats } from "./prActivity";

function pr(over: Partial<GithubPr> & Pick<GithubPr, "id" | "bucket">): GithubPr {
  return {
    repo: "o/r", number: 1, title: "t", draft: false, mergeable: "mergeable",
    ciStatus: "success", reviewDecision: null, authorLogin: "octocat", authorAvatar: null,
    commentCount: 0, branch: "b", url: "u", linearIdentifier: null, linearIssueId: null,
    updatedAt: "2026-06-18T10:00:00Z", ...over,
  };
}

const NOW = new Date("2026-06-22T12:00:00Z");

describe("buildPrHeatmap", () => {
  it("returns weeksBack+1 weeks of 7 cells each", () => {
    const weeks = buildPrHeatmap([], { now: NOW, weeksBack: 4 });
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.cells.length === 7)).toBe(true);
  });

  it("counts each in-window PR once on its updated date", () => {
    const weeks = buildPrHeatmap(
      [pr({ id: "o/r#1", bucket: "mine" }), pr({ id: "o/r#2", bucket: "mine" })],
      { now: NOW, weeksBack: 4 },
    );
    const total = weeks.flatMap((w) => w.cells).reduce((n, c) => n + c.count, 0);
    expect(total).toBe(2);
  });

  it("dedups a PR that appears in multiple buckets", () => {
    const weeks = buildPrHeatmap(
      [pr({ id: "o/r#1", bucket: "needs_review" }), pr({ id: "o/r#1", bucket: "mine" })],
      { now: NOW, weeksBack: 4 },
    );
    const total = weeks.flatMap((w) => w.cells).reduce((n, c) => n + c.count, 0);
    expect(total).toBe(1);
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
