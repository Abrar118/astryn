import { useState } from "react";
import { CornerDownRight } from "lucide-react";
import { useCreateComment, useUsers } from "@/lib/queries";
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
  const create = useCreateComment();
  const users = useUsers();
  const parentId = thread.comment.id;

  return (
    // One faceplate panel per thread; the reply and the reply action sit below hairlines inside it.
    <div className="rounded-lg border border-border bg-card">
      <div className="px-3.5 pt-3 pb-2">
        <CommentCard comment={thread.comment} issueId={issueId} onOpenLink={onOpenLink} resolveMention={resolveMention} />
      </div>

      {thread.replies.map((reply) => (
        <div key={reply.id} className="border-t border-border px-3.5 pt-3 pb-2">
          <CommentCard comment={reply} issueId={issueId} onOpenLink={onOpenLink} resolveMention={resolveMention} />
        </div>
      ))}

      <div className={replying ? "border-t border-border p-2" : "border-t border-border px-2 py-1"}>
        {replying ? (
          <CommentComposer
            variant="reply"
            submitting={create.isPending}
            users={users.data ?? []}
            onOpenLink={onOpenLink}
            resolveMention={resolveMention}
            onCancel={() => setReplying(false)}
            onSubmit={(md) => create.mutate({ issueId, body: md, parentId }, { onSuccess: () => setReplying(false) })}
          />
        ) : (
          <button
            type="button"
            onClick={() => setReplying(true)}
            className="dash-control flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <CornerDownRight className="size-3.5" /> Reply
          </button>
        )}
      </div>
    </div>
  );
}
