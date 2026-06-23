import { useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { gooeyToast } from "goey-toast";
import { Avatar } from "@/components/Avatar";
import { Popover, PopoverItem } from "@/components/Popover";
import { timeAgo } from "../timeAgo";
import {
  useMe, useUpdateComment, useDeleteComment, useAddReaction, useRemoveReaction, useUsers,
} from "@/lib/queries";
import { ReadOnlyDescription } from "../DescriptionEditor";
import { CommentComposer } from "./CommentComposer";
import { ReactionBar } from "./ReactionBar";
import type { AggregatedReaction } from "./reactions";
import type { DetailComment } from "@/lib/commands";
import type { MentionResolver } from "../markdownComponents";

export function AuthorActionsMenu({ close, onEdit, onDelete }: {
  close: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <PopoverItem icon={<Pencil className="size-4" />} label="Edit" onClick={() => { onEdit(); close(); }} />
      {confirming ? (
        <PopoverItem
          icon={<Trash2 className="size-4" />}
          label="Confirm delete"
          danger
          onClick={() => { onDelete(); close(); }}
        />
      ) : (
        <PopoverItem
          icon={<Trash2 className="size-4" />}
          label="Delete"
          danger
          onClick={() => setConfirming(true)}
        />
      )}
    </>
  );
}

export function CommentCard({
  comment, issueId, onOpenLink, resolveMention,
}: {
  comment: DetailComment;
  issueId: string;
  onOpenLink: (href: string) => void;
  resolveMention?: MentionResolver;
}) {
  const me = useMe().data ?? null;
  const meId = me?.viewerId ?? null;
  const isAuthor = comment.userId != null && comment.userId === meId;
  const [editing, setEditing] = useState(false);
  const update = useUpdateComment();
  const del = useDeleteComment();
  const users = useUsers();
  const add = useAddReaction();
  const remove = useRemoveReaction();
  const isPending = comment.id.startsWith("pending-");

  const toggleReaction = (agg: AggregatedReaction) => {
    if (agg.reactedByMe && agg.reactionIdByMe) {
      remove.mutate({ issueId, commentId: comment.id, reactionId: agg.reactionIdByMe });
    } else {
      add.mutate({ issueId, commentId: comment.id, emoji: agg.emoji });
    }
  };

  return (
    <div className={`group min-w-0 flex-1 ${isPending ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2">
        <Avatar
          name={comment.userName ?? "?"}
          src={(users.data ?? []).find((u) => u.id === comment.userId)?.avatarUrl}
          size={22}
        />
        <span className="text-sm font-medium text-foreground">{comment.userName ?? "Unknown"}</span>
        <span className="text-xs text-muted-foreground">
          {timeAgo(comment.createdAt)}{comment.editedAt ? " (edited)" : ""}
        </span>
        {isAuthor && !editing && (
          <div className="ml-auto opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <Popover
              align="end"
              buttonTitle="Comment actions"
              buttonClassName="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              button={<MoreHorizontal className="size-4" />}
              panelClassName="w-40 rounded-lg border border-border bg-popover p-1 shadow-2xl"
            >
              {(close) => (
                <AuthorActionsMenu
                  close={close}
                  onEdit={() => setEditing(true)}
                  onDelete={() => del.mutate({ issueId, id: comment.id }, { onSuccess: () => gooeyToast.success("Comment deleted") })}
                />
              )}
            </Popover>
          </div>
        )}
      </div>

      {/* Inline comment: the document text this comment was anchored to. */}
      {comment.quotedText && (
        <blockquote className="mt-1.5 border-l-2 border-border pl-3 text-sm italic text-muted-foreground">
          {comment.quotedText}
        </blockquote>
      )}

      <div className="mt-1">
        {editing ? (
          <CommentComposer
            variant="edit"
            initialMarkdown={comment.body}
            submitting={update.isPending}
            users={users.data ?? []}
            onOpenLink={onOpenLink}
            resolveMention={resolveMention}
            onCancel={() => setEditing(false)}
            onSubmit={(md) => update.mutate({ issueId, id: comment.id, body: md }, { onSuccess: () => setEditing(false) })}
          />
        ) : (
          <ReadOnlyDescription markdown={comment.body} onOpenLink={onOpenLink} resolveMention={resolveMention} users={users.data ?? []} />
        )}
      </div>

      {!editing && (
        <ReactionBar
          reactions={comment.reactions}
          meId={meId}
          onToggle={toggleReaction}
          onAdd={(emoji) => add.mutate({ issueId, commentId: comment.id, emoji })}
        />
      )}
    </div>
  );
}
