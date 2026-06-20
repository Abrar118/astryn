import type { DetailComment } from "@/lib/commands";

export type CommentThreadData = { comment: DetailComment; replies: DetailComment[] };

const byCreatedAt = (a: DetailComment, b: DetailComment) => a.createdAt.localeCompare(b.createdAt);

/**
 * Group a flat comment list into single-level threads. A comment is top-level
 * when it has no parent, or when its parent is not present in this page (orphan
 * replies degrade to top-level so they are never dropped). Threads and replies
 * are each sorted oldest-first.
 */
export function buildCommentThreads(comments: DetailComment[]): CommentThreadData[] {
  const ids = new Set(comments.map((c) => c.id));
  const repliesByParent = new Map<string, DetailComment[]>();
  const topLevel: DetailComment[] = [];

  for (const comment of comments) {
    const isReply = comment.parentId != null && ids.has(comment.parentId);
    if (isReply) {
      const list = repliesByParent.get(comment.parentId as string);
      if (list) list.push(comment);
      else repliesByParent.set(comment.parentId as string, [comment]);
    } else {
      topLevel.push(comment);
    }
  }

  return topLevel
    .sort(byCreatedAt)
    .map((comment) => ({
      comment,
      replies: (repliesByParent.get(comment.id) ?? []).sort(byCreatedAt),
    }));
}
