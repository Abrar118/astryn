import { useState } from "react";
import { ChevronRight, ExternalLink, Hash, MessageCircle, MessagesSquare } from "lucide-react";
import { useWorkspace } from "@/lib/tabs";
import type { ChatConversation, ChatMessage, ChatThread } from "@/lib/commands";
import { IndicatorLamp } from "@/components/IndicatorLamp";
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
      className="dash-control rounded-md border border-input px-1.5 font-mono text-[12px] leading-5 text-foreground transition-colors hover:bg-accent"
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
      title={provider.openLabel}
      onClick={() => void provider.open(conversationId, ts)}
      className="dash-control flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
    >
      <ExternalLink aria-hidden className="size-3.5" />
    </button>
  );
}

/** "Mentions you" read off a warning lamp, the same signal the Dashboard queue uses. */
function MentionLamp() {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-foreground">
      <IndicatorLamp tone="warning" />
      mentions you
    </span>
  );
}

/** An expandable row: chevron, monochrome kind glyph, name, detail, and the reader below. */
function ExpandableRow({
  icon: Icon,
  name,
  detail,
  aside,
  conversationId,
  ts,
  provider,
}: {
  icon: typeof Hash;
  name: string;
  detail: string | null;
  aside: React.ReactNode;
  conversationId: string;
  ts: string | null;
  provider: ChatProvider;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex items-center gap-1 pr-3 transition-colors hover:bg-accent">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${name}`}
          className="dash-control flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left"
        >
          <ChevronRight aria-hidden className={`size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-[14px] font-medium text-foreground">{name}</span>
          {detail && <span className="min-w-0 truncate text-[13px] text-muted-foreground">{detail}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-3 pl-2">{aside}</span>
        </button>
        <OpenButton provider={provider} conversationId={conversationId} ts={ts} />
      </div>
      {open && <ChatReader conversationId={conversationId} load={provider.loadMessages} />}
    </div>
  );
}

export function ChatConversationRow({ conv, provider }: { conv: ChatConversation; provider: ChatProvider }) {
  return (
    <ExpandableRow
      icon={conv.kind === "channel" ? Hash : MessageCircle}
      name={conv.name ?? conv.id}
      detail={conv.latestSnippet}
      aside={
        <>
          {conv.hasMention && <MentionLamp />}
          <span className="min-w-5 text-right text-[13px] tabular-nums text-foreground" title={`${conv.unreadCount} unread`}>
            {conv.unreadCount}
          </span>
        </>
      }
      conversationId={conv.id}
      ts={conv.latestTs}
      provider={provider}
    />
  );
}

export function ChatMentionRow({ msg, convName, provider }: { msg: ChatMessage; convName: string; provider: ChatProvider }) {
  return (
    <div className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-start gap-x-3 py-3 pl-4 pr-3 transition-colors hover:bg-accent">
      <IndicatorLamp tone="warning" className="mt-1.5" />
      <div className="min-w-0">
        <p className="flex min-w-0 items-baseline gap-2 text-[12px] text-muted-foreground">
          <span className="truncate font-medium text-foreground">{msg.userName ?? msg.userId ?? "unknown"}</span>
          <span className="truncate">in {convName}</span>
        </p>
        <p className="mt-0.5 text-[14px] text-foreground">{msg.text}</p>
      </div>
      <span className="flex shrink-0 items-center gap-2">
        <LinearChip msg={msg} />
        <OpenButton provider={provider} conversationId={msg.conversationId} ts={msg.ts} />
      </span>
    </div>
  );
}

export function ChatThreadRow({ thread, provider }: { thread: ChatThread; provider: ChatProvider }) {
  return (
    <ExpandableRow
      icon={MessagesSquare}
      name={thread.conversationName ?? thread.conversationId}
      detail={`${thread.unreadReplies} new repl${thread.unreadReplies === 1 ? "y" : "ies"}`}
      aside={thread.hasMention ? <MentionLamp /> : null}
      conversationId={thread.conversationId}
      ts={thread.threadTs}
      provider={provider}
    />
  );
}
