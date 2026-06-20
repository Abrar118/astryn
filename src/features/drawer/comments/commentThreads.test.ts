import { describe, expect, it } from "vitest";
import { buildCommentThreads } from "./commentThreads";
import type { DetailComment } from "@/lib/commands";

const c = (id: string, createdAt: string, parentId: string | null = null): DetailComment => ({
  id, body: id, userId: "u", userName: "U", createdAt, editedAt: null, parentId, reactions: [],
});

describe("buildCommentThreads", () => {
  it("nests replies under their parent, sorted by createdAt", () => {
    const threads = buildCommentThreads([
      c("a", "2026-06-20T10:00:00Z"),
      c("a2", "2026-06-20T10:30:00Z", "a"),
      c("b", "2026-06-20T09:00:00Z"),
      c("a1", "2026-06-20T10:10:00Z", "a"),
    ]);
    expect(threads.map((t) => t.comment.id)).toEqual(["b", "a"]); // top-level by createdAt asc
    expect(threads[1].replies.map((r) => r.id)).toEqual(["a1", "a2"]); // replies by createdAt asc
  });

  it("promotes an orphan reply (parent outside the page) to top-level", () => {
    const threads = buildCommentThreads([c("x", "2026-06-20T10:00:00Z", "missing")]);
    expect(threads).toHaveLength(1);
    expect(threads[0].comment.id).toBe("x");
    expect(threads[0].replies).toEqual([]);
  });
});
