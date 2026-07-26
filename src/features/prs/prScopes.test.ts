// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { GithubPr } from "@/lib/commands";
import {
  PR_GROUP_KEY,
  knownRepos,
  loadGroupByRepo,
  repoScope,
  saveGroupByRepo,
  scopePrs,
} from "./prScopes";

function pr(over: Partial<GithubPr> & Pick<GithubPr, "id" | "bucket" | "repo">): GithubPr {
  return {
    number: 1,
    title: "t",
    draft: false,
    mergeable: "mergeable",
    ciStatus: "success",
    reviewDecision: null,
    authorLogin: "octocat",
    authorAvatar: null,
    commentCount: 0,
    branch: "b",
    baseBranch: "main",
    url: "u",
    linearIdentifier: null,
    linearIssueId: null,
    updatedAt: "2026-06-18T10:00:00Z",
    mergedAt: null,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    linearStateName: null,
    linearStateType: null,
    linearStateColor: null,
    linearPriority: null,
    reviewers: [],
    ...over,
  };
}

describe("PR scopes", () => {
  beforeEach(() => localStorage.clear());

  it("normalizes repository scope keys", () => {
    expect(repoScope(" Owner/Repo ")).toBe("repo:owner/repo");
  });

  it("selects and deduplicates rows in the active scope", () => {
    const rows = [
      pr({ id: "o/r#1", bucket: "repo:o/r", repo: "o/r" }),
      pr({ id: "o/r#1", bucket: "repo:o/r", repo: "o/r" }),
      pr({ id: "o/r#2", bucket: "repo:o/r", repo: "o/r" }),
      pr({ id: "o/r#3", bucket: "mine", repo: "o/r" }),
    ];
    expect(scopePrs(rows, "repo:o/r").map((row) => row.id)).toEqual(["o/r#1", "o/r#2"]);
  });

  it("lists known repositories once and excludes current favorites", () => {
    const rows = [
      pr({ id: "A/One#1", bucket: "mine", repo: "A/One" }),
      pr({ id: "a/one#2", bucket: "assigned", repo: "a/one" }),
      pr({ id: "B/Two#1", bucket: "needs_review", repo: "B/Two" }),
    ];
    expect(
      knownRepos(rows, ["a/ONE"], [
        "Viewer/Personal",
        "Org/Platform",
        "b/two",
      ]),
    ).toEqual(["B/Two", "Org/Platform", "Viewer/Personal"]);
  });

  it("defaults grouping to true for missing or invalid state", () => {
    expect(loadGroupByRepo()).toBe(true);
    localStorage.setItem(PR_GROUP_KEY, "broken");
    expect(loadGroupByRepo()).toBe(true);
  });

  it("round-trips an explicit false grouping preference", () => {
    saveGroupByRepo(false);
    expect(localStorage.getItem(PR_GROUP_KEY)).toBe("false");
    expect(loadGroupByRepo()).toBe(false);
  });
});
