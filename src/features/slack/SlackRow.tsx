import type { SlackConversation, SlackMessage, SlackThread } from "@/lib/commands";

export function SlackRow({ conv }: { conv: SlackConversation }) {
  return (
    <div className="border-b border-border/50 px-5 py-3 text-sm last:border-b-0">
      {conv.name ?? conv.id} · {conv.unreadCount} unread
    </div>
  );
}

export function SlackMentionRow({ msg, convName }: { msg: SlackMessage; convName: string }) {
  return (
    <div className="border-b border-border/50 px-5 py-3 text-sm last:border-b-0">
      {convName}: {msg.text}
    </div>
  );
}

export function SlackThreadRow({ thread }: { thread: SlackThread }) {
  return (
    <div className="border-b border-border/50 px-5 py-3 text-sm last:border-b-0">
      {thread.conversationName ?? thread.conversationId} · {thread.unreadReplies} new replies
    </div>
  );
}
