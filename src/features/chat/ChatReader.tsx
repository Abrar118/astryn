import { useEffect, useState } from "react";
import type { ChatMessage } from "@/lib/commands";

/** Read-only list of a conversation's cached unread messages. */
export function ChatReader({
  conversationId,
  load,
}: {
  conversationId: string;
  load: (conversationId: string) => Promise<ChatMessage[]>;
}) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  useEffect(() => {
    let live = true;
    load(conversationId)
      .then((m) => { if (live) setMessages(m); })
      .catch(() => { if (live) setMessages([]); });
    return () => { live = false; };
  }, [conversationId, load]);

  if (messages === null) return <div className="px-5 py-3 text-xs text-muted-foreground">Loading…</div>;
  if (messages.length === 0) return <div className="px-5 py-3 text-xs text-muted-foreground">No cached messages.</div>;

  return (
    <div className="flex flex-col gap-2 border-t border-border/50 bg-background/40 px-5 py-3">
      {messages.map((m) => (
        <div key={m.ts} className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-foreground">{m.userName ?? m.userId ?? "unknown"}</span>
          <span className="whitespace-pre-wrap text-sm text-muted-foreground">{m.text}</span>
        </div>
      ))}
    </div>
  );
}
