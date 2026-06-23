import { describe, expect, it } from "vitest";
import { buildActivity, historyCategory, mergeActivityTimeline } from "./drawerActivity";
import type { DetailHistory } from "@/lib/commands";
import type { CommentThreadData } from "./comments/commentThreads";

// Minimal DetailHistory fixture with all required fields
const baseHistory: DetailHistory = {
  id: "h1",
  createdAt: "2026-06-19T09:00:00Z",
  actorName: null,
  fromStateName: null,
  toStateName: null,
  toStateType: null,
  toStateColor: null,
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

describe("historyCategory", () => {
  it("returns 'status' for a state change", () => {
    expect(historyCategory({ ...baseHistory, fromStateName: "Todo", toStateName: "In Progress" })).toBe("status");
  });

  it("returns 'assignee' for an assignee change", () => {
    expect(historyCategory({ ...baseHistory, toAssigneeName: "Abrar" })).toBe("assignee");
  });

  it("returns 'priority' for a priority change", () => {
    expect(historyCategory({ ...baseHistory, fromPriority: 0, toPriority: 2 })).toBe("priority");
  });

  it("returns 'title' for a title change", () => {
    expect(historyCategory({ ...baseHistory, fromTitle: "Old title", toTitle: "New title" })).toBe("title");
  });

  it("returns 'description' for a description update", () => {
    expect(historyCategory({ ...baseHistory, updatedDescription: true })).toBe("description");
  });

  it("returns 'relation' for a relation change", () => {
    expect(historyCategory({ ...baseHistory, relationChanges: [{ type: "related", identifier: "AST-9" }] })).toBe("relation");
  });

  it("returns 'attachment' for an attachment event", () => {
    expect(historyCategory({
      ...baseHistory,
      attachment: { id: "a1", title: "PR #1", subtitle: null, url: "https://github.com", sourceType: "github", createdAt: "2026-06-19T09:00:00Z", body: null },
    })).toBe("attachment");
  });

  it("returns 'update' for a bare event with no recognized fields", () => {
    expect(historyCategory(baseHistory)).toBe("update");
  });

  it("'relation' wins over 'status' (same precedence as historySummary)", () => {
    // An event with both a state change AND a relation change → relation wins
    expect(historyCategory({
      ...baseHistory,
      fromStateName: "Todo",
      toStateName: "Done",
      relationChanges: [{ type: "related", identifier: "AST-5" }],
    })).toBe("relation");
  });

  it("'attachment' wins over 'relation' (highest precedence)", () => {
    expect(historyCategory({
      ...baseHistory,
      relationChanges: [{ type: "related", identifier: "AST-5" }],
      attachment: { id: "a1", title: "Doc", subtitle: null, url: "https://example.com", sourceType: "web", createdAt: "2026-06-19T09:00:00Z", body: null },
    })).toBe("attachment");
  });
});

describe("buildActivity", () => {
  it("merges creation and history in chronological order", () => {
    const items = buildActivity({
      createdAt: "2026-06-19T08:00:00Z",
      creatorName: "Abrar",
      history: [
        {
          ...baseHistory,
          actorName: "Abrar",
          fromStateName: "Todo",
          toStateName: "In Progress",
          toStateType: "started",
          toStateColor: "#eab308",
        },
      ],
    });

    expect(items.map((item) => item.kind)).toEqual(["created", "history"]);
    expect(items[1]).toMatchObject({ summary: "moved from Todo to In Progress" });
  });

  it("carries category, toStateType, toStateColor on history items", () => {
    const items = buildActivity({
      createdAt: "2026-06-19T08:00:00Z",
      creatorName: null,
      history: [
        {
          ...baseHistory,
          fromStateName: "Todo",
          toStateName: "In Progress",
          toStateType: "started",
          toStateColor: "#eab308",
        },
      ],
    });
    const h = items.find((i) => i.kind === "history");
    expect(h).toMatchObject({ category: "status", toStateType: "started", toStateColor: "#eab308" });
  });

  it("describes attachment, relation, and description history without raw payloads", () => {
    const items = buildActivity({
      createdAt: "",
      creatorName: null,
      history: [
        { ...baseHistory, id: "attachment", attachment: { id: "a1", title: "PR #324", subtitle: null, url: "https://github.com/o/r/pull/324", sourceType: "github", createdAt: "2026-06-19T09:00:00Z", body: null } },
        { ...baseHistory, id: "relation", relationChanges: [{ type: "related", identifier: "AST-9" }] },
        { ...baseHistory, id: "description", updatedDescription: true },
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
    quotedText: null,
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
          ...baseHistory,
          id: "h1",
          createdAt: "2026-01-03T00:00:00Z",
          actorName: "Alice",
          fromStateName: "Todo",
          toStateName: "Done",
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
