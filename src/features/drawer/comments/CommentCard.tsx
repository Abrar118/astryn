import { useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { gooeyToast } from "goey-toast";
import { Avatar } from "@/components/Avatar";
import { Popover, PopoverItem } from "@/components/Popover";
import { timeAgo } from "../timeAgo";
import {
  useMe, useUpdateComment, useDeleteComment, useAddReaction, useRemoveReaction,
} from "@/lib/queries";
import { ReadOnlyDescription } from "../DescriptionEditor";
import { CommentComposer } from "./CommentComposer";
import { ReactionBar } from "./ReactionBar";
import type { AggregatedReaction } from "./reactions";
import type { DetailComment } from "@/lib/commands";
import type { MentionResolver } from "../markdownComponents";

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
  const [editKey, setEditKey] = useState(0);
  const update = useUpdateComment();
  const del = useDeleteComment();
  const add = useAddReaction();
  const remove = useRemoveReaction();
  const isPending = comment.id.startsWith("pending-");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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
        <Avatar name={comment.userName ?? "?"} size={22} />
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
              {(close) => {
                const closeAndReset = () => { setConfirmingDelete(false); close(); };
                return (
                  <>
                    <PopoverItem icon={<Pencil className="size-4" />} label="Edit" onClick={() => { setEditing(true); closeAndReset(); }} />
                    {confirmingDelete ? (
                      <PopoverItem
                        icon={<Trash2 className="size-4" />}
                        label="Confirm delete"
                        danger
                        onClick={() => {
                          del.mutate({ issueId, id: comment.id });
                          closeAndReset();
                          gooeyToast.success("Comment deleted");
                        }}
                      />
                    ) : (
                      <PopoverItem
                        icon={<Trash2 className="size-4" />}
                        label="Delete"
                        danger
                        onClick={() => setConfirmingDelete(true)}
                      />
                    )}
                  </>
                );
              }}
            </Popover>
          </div>
        )}
      </div>

      <div className="mt-1">
        {editing ? (
          <CommentComposer
            key={editKey}
            variant="edit"
            initialMarkdown={comment.body}
            submitting={update.isPending}
            onOpenLink={onOpenLink}
            resolveMention={resolveMention}
            onCancel={() => setEditing(false)}
            onSubmit={(md) => {
              update.mutate({ issueId, id: comment.id, body: md });
              setEditing(false);
              setEditKey((k) => k + 1);
            }}
          />
        ) : (
          <ReadOnlyDescription markdown={comment.body} onOpenLink={onOpenLink} resolveMention={resolveMention} />
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
