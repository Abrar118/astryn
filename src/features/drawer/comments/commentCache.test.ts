import { describe, expect, it } from "vitest";
import {
  addComment, replaceComment, editComment, removeCommentDeep,
  addReactionTo, removeReactionFrom, replaceReaction, makePendingComment, makePendingReaction,
} from "./commentCache";
import type { DetailComment, IssueDetailResult, LiveDetail } from "@/lib/commands";

const comment = (id: string, parentId: string | null = null): DetailComment => ({
  id, body: id, userId: "u1", userName: "U", createdAt: "t", editedAt: null, parentId, reactions: [],
});
const live = (comments: DetailComment[]): IssueDetailResult =>
  ({ source: "live", detail: { comments } as unknown as LiveDetail });

describe("commentCache", () => {
  it("addComment appends; cache source !== live is untouched", () => {
    const r = addComment(live([]), comment("a"));
    expect((r.detail as LiveDetail).comments.map((c) => c.id)).toEqual(["a"]);
    const cache = { source: "cache", detail: {} } as IssueDetailResult;
    expect(addComment(cache, comment("a"))).toBe(cache);
  });

  it("replaceComment swaps the temp id for the server comment", () => {
    const r = replaceComment(live([comment("temp")]), "temp", comment("real"));
    expect((r.detail as LiveDetail).comments[0].id).toBe("real");
  });

  it("editComment sets body + editedAt", () => {
    const r = editComment(live([comment("a")]), "a", "new body", "edited-at");
    const c = (r.detail as LiveDetail).comments[0];
    expect(c.body).toBe("new body");
    expect(c.editedAt).toBe("edited-at");
  });

  it("removeCommentDeep drops the comment and its replies", () => {
    const r = removeCommentDeep(live([comment("a"), comment("a1", "a"), comment("b")]), "a");
    expect((r.detail as LiveDetail).comments.map((c) => c.id)).toEqual(["b"]);
  });

  it("addReactionTo / removeReactionFrom mutate a single comment's reactions", () => {
    const re = makePendingReaction("re1", "👍", { viewerId: "u1", viewerName: "U" });
    const added = addReactionTo(live([comment("a")]), "a", re);
    expect((added.detail as LiveDetail).comments[0].reactions[0].emoji).toBe("👍");
    const removed = removeReactionFrom(added, "a", "re1");
    expect((removed.detail as LiveDetail).comments[0].reactions).toEqual([]);
  });

  it("replaceReaction swaps the temp reaction id for the server reaction", () => {
    const tempReaction = makePendingReaction("temp-re", "👍", { viewerId: "u1", viewerName: "U" });
    const commentWithReaction: DetailComment = { ...comment("c1"), reactions: [tempReaction] };
    const serverReaction = { id: "server-re", emoji: "👍", userId: "u1", userName: "U" };
    const r = replaceReaction(live([commentWithReaction]), "c1", "temp-re", serverReaction);
    expect((r.detail as LiveDetail).comments[0].reactions[0].id).toBe("server-re");
  });

  it("makePendingComment attributes to me", () => {
    const p = makePendingComment("temp1", "hi", null, { viewerId: "u1", viewerName: "Abrar" });
    expect(p).toMatchObject({ id: "temp1", body: "hi", parentId: null, userId: "u1", userName: "Abrar" });
  });
});
