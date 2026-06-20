import { useState } from "react";
import { CornerDownRight } from "lucide-react";
import { useCreateComment } from "@/lib/queries";
import { CommentCard } from "./CommentCard";
import { CommentComposer } from "./CommentComposer";
import type { CommentThreadData } from "./commentThreads";
import type { MentionResolver } from "../markdownComponents";

export function CommentThread({
  thread, issueId, onOpenLink, resolveMention,
}: {
  thread: CommentThreadData;
  issueId: string;
  onOpenLink: (href: string) => void;
  resolveMention?: MentionResolver;
}) {
  const [replying, setReplying] = useState(false);
  const [replyKey, setReplyKey] = useState(0);
  const create = useCreateComment();
  const parentId = thread.comment.id;

  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      <CommentCard comment={thread.comment} issueId={issueId} onOpenLink={onOpenLink} resolveMention={resolveMention} />

      {thread.replies.length > 0 && (
        <div className="mt-3 space-y-3 border-l border-border pl-3">
          {thread.replies.map((reply) => (
            <CommentCard key={reply.id} comment={reply} issueId={issueId} onOpenLink={onOpenLink} resolveMention={resolveMention} />
          ))}
        </div>
      )}

      <div className="mt-2 pl-3">
        {replying ? (
          <CommentComposer
            key={replyKey}
            variant="reply"
            submitting={create.isPending}
            onOpenLink={onOpenLink}
            resolveMention={resolveMention}
            onCancel={() => setReplying(false)}
            onSubmit={(md) => {
              create.mutate({ issueId, body: md, parentId });
              setReplying(false);
              setReplyKey((k) => k + 1);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setReplying(true)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CornerDownRight className="size-3.5" /> Reply
          </button>
        )}
      </div>
    </div>
  );
}
