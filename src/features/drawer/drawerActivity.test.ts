import { describe, expect, it } from "vitest";
import { buildActivity } from "./drawerActivity";

describe("buildActivity", () => {
  it("merges creation, history, and comments in chronological order", () => {
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
      comments: [
        { id: "c1", body: "Ready for review", userName: "Mahir", createdAt: "2026-06-19T10:00:00Z" },
      ],
    });

    expect(items.map((item) => item.kind)).toEqual(["created", "history", "comment"]);
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
      comments: [],
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
