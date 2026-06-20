import type { DetailComment, DetailReaction, IssueDetailResult, Me } from "@/lib/commands";

/** Apply `fn` to the live comment list; non-live results pass through unchanged. */
function withComments(
  result: IssueDetailResult,
  fn: (comments: DetailComment[]) => DetailComment[],
): IssueDetailResult {
  if (result.source !== "live") return result;
  return { ...result, detail: { ...result.detail, comments: fn(result.detail.comments) } };
}

export function addComment(result: IssueDetailResult, comment: DetailComment): IssueDetailResult {
  return withComments(result, (cs) => [...cs, comment]);
}

export function replaceComment(
  result: IssueDetailResult,
  tempId: string,
  comment: DetailComment,
): IssueDetailResult {
  return withComments(result, (cs) => cs.map((c) => (c.id === tempId ? comment : c)));
}

export function editComment(
  result: IssueDetailResult,
  id: string,
  body: string,
  editedAt: string | null,
): IssueDetailResult {
  return withComments(result, (cs) => cs.map((c) => (c.id === id ? { ...c, body, editedAt } : c)));
}

export function removeCommentDeep(result: IssueDetailResult, id: string): IssueDetailResult {
  return withComments(result, (cs) => cs.filter((c) => c.id !== id && c.parentId !== id));
}

function withReactions(
  result: IssueDetailResult,
  commentId: string,
  fn: (reactions: DetailReaction[]) => DetailReaction[],
): IssueDetailResult {
  return withComments(result, (cs) =>
    cs.map((c) => (c.id === commentId ? { ...c, reactions: fn(c.reactions) } : c)),
  );
}

export function addReactionTo(
  result: IssueDetailResult,
  commentId: string,
  reaction: DetailReaction,
): IssueDetailResult {
  return withReactions(result, commentId, (rs) => [...rs, reaction]);
}

export function removeReactionFrom(
  result: IssueDetailResult,
  commentId: string,
  reactionId: string,
): IssueDetailResult {
  return withReactions(result, commentId, (rs) => rs.filter((r) => r.id !== reactionId));
}

export function makePendingComment(
  id: string,
  _issueId: string,
  body: string,
  parentId: string | null,
  me: Me | null,
): DetailComment {
  return {
    id,
    body,
    userId: me?.viewerId ?? null,
    userName: me?.viewerName ?? null,
    createdAt: new Date().toISOString(),
    editedAt: null,
    parentId,
    reactions: [],
  };
}

export function makePendingReaction(id: string, emoji: string, me: Me | null): DetailReaction {
  return { id, emoji, userId: me?.viewerId ?? null, userName: me?.viewerName ?? null };
}
