import { describe, expect, it } from "vitest";
import { buildActivity, mergeActivityTimeline } from "./drawerActivity";
import type { CommentThreadData } from "./comments/commentThreads";

describe("buildActivity", () => {
  it("merges creation and history in chronological order", () => {
    const items = buildActivity({
      createdAt: "2026-06-19T08:00:00Z",
      creatorName: "Abrar",
      history: [
        {
          id: "h1",
          createdAt: "2026-06-19T09:00:00Z",
          actorName: "Abrar",
          fromStateName: "Todo",
          toStateName: "In Progress",
          fromAssigneeName: null,
          toAssigneeName: null,
          fromPriority: null,
          toPriority: null,
          fromTitle: null,
          toTitle: null,
          updatedDescription: false,
          attachment: null,
          relationChanges: [],
        },
      ],
    });

    expect(items.map((item) => item.kind)).toEqual(["created", "history"]);
    expect(items[1]).toMatchObject({ summary: "moved from Todo to In Progress" });
  });

  it("describes attachment, relation, and description history without raw payloads", () => {
    const base = {
      id: "h1",
      createdAt: "2026-06-19T09:00:00Z",
      actorName: null,
      fromStateName: null,
      toStateName: null,
      fromAssigneeName: null,
      toAssigneeName: null,
      fromPriority: null,
      toPriority: null,
      fromTitle: null,
      toTitle: null,
      updatedDescription: false,
      attachment: null,
      relationChanges: [],
    };
    const items = buildActivity({
      createdAt: "",
      creatorName: null,
      history: [
        { ...base, id: "attachment", attachment: { id: "a1", title: "PR #324", subtitle: null, url: "https://github.com/o/r/pull/324", sourceType: "github", createdAt: "2026-06-19T09:00:00Z", body: null } },
        { ...base, id: "relation", relationChanges: [{ type: "related", identifier: "AST-9" }] },
        { ...base, id: "description", updatedDescription: true },
      ],
    });

    expect(items.map((item) => item.summary)).toEqual([
      "linked PR #324",
      "related issue AST-9",
      "updated the description",
    ]);
  });
});

describe("mergeActivityTimeline", () => {
  const baseComment = {
    id: "",
    parentId: null,
    body: "",
    userId: null,
    userName: null,
    createdAt: "",
    editedAt: null,
    reactions: [],
  };

  it("interleaves events and threads sorted by createdAt", () => {
    const activity = buildActivity({
      createdAt: "2026-01-01T00:00:00Z",
      creatorName: "Alice",
      history: [
        {
          id: "h1",
          createdAt: "2026-01-03T00:00:00Z",
          actorName: "Alice",
          fromStateName: "Todo",
          toStateName: "Done",
          fromAssigneeName: null,
          toAssigneeName: null,
          fromPriority: null,
          toPriority: null,
          fromTitle: null,
          toTitle: null,
          updatedDescription: false,
          attachment: null,
          relationChanges: [],
        },
      ],
    });

    const threads: CommentThreadData[] = [
      {
        comment: { ...baseComment, id: "c1", createdAt: "2026-01-02T00:00:00Z" },
        replies: [],
      },
      {
        comment: { ...baseComment, id: "c2", createdAt: "2026-01-04T00:00:00Z" },
        replies: [],
      },
    ];

    const timeline = mergeActivityTimeline(activity, threads);

    expect(timeline.map((e) => ({ kind: e.kind, createdAt: e.createdAt }))).toEqual([
      { kind: "event",  createdAt: "2026-01-01T00:00:00Z" },
      { kind: "thread", createdAt: "2026-01-02T00:00:00Z" },
      { kind: "event",  createdAt: "2026-01-03T00:00:00Z" },
      { kind: "thread", createdAt: "2026-01-04T00:00:00Z" },
    ]);
  });

  it("returns [] for empty input", () => {
    expect(mergeActivityTimeline([], [])).toEqual([]);
  });
});
