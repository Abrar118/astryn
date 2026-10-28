import { useState } from "react";
import { ChevronRight, Hash, MessageCircle, MessagesSquare } from "lucide-react";
import { useWorkspace } from "@/lib/tabs";
import type { ChatConversation, ChatMessage, ChatThread } from "@/lib/commands";
import type { ChatProvider } from "./provider";
import { ChatReader } from "./ChatReader";

function LinearChip({ msg }: { msg: ChatMessage }) {
  const { openIssueTab } = useWorkspace();
  if (!msg.linearIssueId || !msg.linearIdentifier) return null;
  return (
    <button
      type="button"
      aria-label={`Open ${msg.linearIdentifier}`}
      onClick={() => openIssueTab(msg.linearIssueId!)}
      className="rounded-md border border-primary/40 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
    >
      {msg.linearIdentifier}
    </button>
  );
}

function OpenButton({ provider, conversationId, ts }: { provider: ChatProvider; conversationId: string; ts?: string | null }) {
  return (
    <button
      type="button"
      aria-label={provider.openLabel}
      onClick={() => void provider.open(conversationId, ts)}
      className="shrink-0 rounded-md border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06]"
    >
      {provider.openLabel}
    </button>
  );
}

export function ChatConversationRow({ conv, provider }: { conv: ChatConversation; provider: ChatProvider }) {
  const [open, setOpen] = useState(false);
  const Icon = conv.kind === "channel" ? Hash : MessageCircle;
  return (
    <div className="border-b border-border/50 last:border-b-0">
      <div className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-foreground/[0.03]">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-label={open ? "Collapse" : "Expand"} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-sm font-medium text-foreground">{conv.name ?? conv.id}</span>
          {conv.latestSnippet && <span className="min-w-0 truncate text-xs text-muted-foreground">{conv.latestSnippet}</span>}
          <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
            {conv.unreadCount}
          </span>
          {conv.hasMention && <span className="shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">@</span>}
        </button>
        <OpenButton provider={provider} conversationId={conv.id} ts={conv.latestTs} />
      </div>
      {open && <ChatReader conversationId={conv.id} load={provider.loadMessages} />}
    </div>
  );
}

export function ChatMentionRow({ msg, convName, provider }: { msg: ChatMessage; convName: string; provider: ChatProvider }) {
  return (
    <div className="group flex items-start gap-3 border-b border-border/50 px-5 py-3 transition-colors last:border-b-0 hover:bg-foreground/[0.03]">
      <span className="mt-0.5 shrink-0 text-xs font-medium text-muted-foreground">{convName}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm text-foreground">
          <span className="font-medium">{msg.userName ?? msg.userId ?? "unknown"}</span>{" "}
          <span className="text-muted-foreground">{msg.text}</span>
        </span>
      </div>
      <span className="flex shrink-0 items-center gap-2">
        <LinearChip msg={msg} />
        <OpenButton provider={provider} conversationId={msg.conversationId} ts={msg.ts} />
      </span>
    </div>
  );
}

export function ChatThreadRow({ thread, provider }: { thread: ChatThread; provider: ChatProvider }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border/50 last:border-b-0">
      <div className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-foreground/[0.03]">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-label={open ? "Collapse" : "Expand"} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
          <MessagesSquare className="size-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-sm font-medium text-foreground">{thread.conversationName ?? thread.conversationId}</span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">{thread.unreadReplies} new repl{thread.unreadReplies === 1 ? "y" : "ies"}</span>
          {thread.hasMention && <span className="ml-auto shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">@</span>}
        </button>
        <OpenButton provider={provider} conversationId={thread.conversationId} ts={thread.threadTs} />
      </div>
      {open && <ChatReader conversationId={thread.conversationId} load={provider.loadMessages} />}
    </div>
  );
}
