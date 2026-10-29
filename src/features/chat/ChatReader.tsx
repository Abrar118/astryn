import { useEffect, useState } from "react";
import type { ChatMessage } from "@/lib/commands";
import { IndicatorLamp } from "@/components/IndicatorLamp";

/** Read-only list of a conversation's cached unread messages, set into the row as a well. */
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

  if (messages === null || messages.length === 0) {
    return (
      <div className="flex items-center gap-3 border-t border-border/70 bg-background py-3 pr-4 pl-11 text-[13px] text-muted-foreground">
        <IndicatorLamp tone="off" />
        {messages === null ? "Reading cached messages…" : "No cached messages."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border/70 bg-background py-3 pr-4 pl-11">
      {messages.map((m) => (
        <div key={m.ts} className="flex flex-col gap-0.5">
          <span className="text-[12px] font-medium text-foreground">{m.userName ?? m.userId ?? "unknown"}</span>
          <span className="whitespace-pre-wrap text-[14px] text-foreground">{m.text}</span>
        </div>
      ))}
    </div>
  );
}
