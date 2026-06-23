import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronRight, Hash, MessageCircle, MessagesSquare } from "lucide-react";
import { useWorkspace } from "@/lib/tabs";
import { slackDeepLink, type SlackConversation, type SlackMessage, type SlackThread } from "@/lib/commands";
import { SlackReader } from "./SlackReader";

async function openInSlack(conversationId: string, ts?: string | null) {
  try {
    const link = await slackDeepLink(conversationId, ts ?? null);
    await openUrl(link.app);
  } catch {
    /* sanitized: a missing identity just no-ops the open */
  }
}

function LinearChip({ msg }: { msg: SlackMessage }) {
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

function OpenInSlack({ conversationId, ts }: { conversationId: string; ts?: string | null }) {
  return (
    <button
      type="button"
      aria-label="Open in Slack"
      onClick={() => openInSlack(conversationId, ts)}
      className="shrink-0 rounded-md border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/[0.06]"
    >
      Open in Slack
    </button>
  );
}

export function SlackRow({ conv }: { conv: SlackConversation }) {
  const [open, setOpen] = useState(false);
  const Icon = conv.kind === "channel" ? Hash : MessageCircle;
  return (
    <div className="border-b border-border/50 last:border-b-0">
      <div className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.03]">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-label={open ? "Collapse" : "Expand"} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-sm font-medium text-foreground">{conv.name ?? conv.id}</span>
          {conv.latestSnippet && <span className="min-w-0 truncate text-xs text-muted-foreground">{conv.latestSnippet}</span>}
          <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
            {conv.unreadCount}
          </span>
          {conv.hasMention && <span className="shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">@</span>}
        </button>
        <OpenInSlack conversationId={conv.id} ts={conv.latestTs} />
      </div>
      {open && <SlackReader conversationId={conv.id} />}
    </div>
  );
}

export function SlackMentionRow({ msg, convName }: { msg: SlackMessage; convName: string }) {
  return (
    <div className="group flex items-start gap-3 border-b border-border/50 px-5 py-3 transition-colors last:border-b-0 hover:bg-white/[0.03]">
      <span className="mt-0.5 shrink-0 text-xs font-medium text-muted-foreground">{convName}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm text-foreground">
          <span className="font-medium">{msg.userName ?? msg.userId ?? "unknown"}</span>{" "}
          <span className="text-muted-foreground">{msg.text}</span>
        </span>
      </div>
      <span className="flex shrink-0 items-center gap-2">
        <LinearChip msg={msg} />
        <OpenInSlack conversationId={msg.conversationId} ts={msg.ts} />
      </span>
    </div>
  );
}

export function SlackThreadRow({ thread }: { thread: SlackThread }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border/50 last:border-b-0">
      <div className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.03]">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-label={open ? "Collapse" : "Expand"} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
          <MessagesSquare className="size-4 shrink-0 text-sky-400" />
          <span className="shrink-0 text-sm font-medium text-foreground">{thread.conversationName ?? thread.conversationId}</span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">{thread.unreadReplies} new repl{thread.unreadReplies === 1 ? "y" : "ies"}</span>
          {thread.hasMention && <span className="ml-auto shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">@</span>}
        </button>
        <OpenInSlack conversationId={thread.conversationId} ts={thread.threadTs} />
      </div>
      {open && <SlackReader conversationId={thread.conversationId} />}
    </div>
  );
}
