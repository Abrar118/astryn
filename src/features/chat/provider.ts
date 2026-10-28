import type { ChatMessage } from "@/lib/commands";

/** The catch-up board sections, in signal order. */
export type ChatSection = "mentions" | "dms" | "threads" | "channels";

/**
 * What the provider-neutral chat board needs from a chat provider module
 * (Slack, Teams). All network work stays behind the provider's Rust commands.
 */
export type ChatProvider = {
  /** Display name, e.g. "Slack". */
  name: string;
  /** Label of the per-row "open in the native client" action. */
  openLabel: string;
  /** Open a conversation, or one message in it, in the provider's client. */
  open: (conversationId: string, ts?: string | null) => Promise<void>;
  /** Cached unread messages of one conversation (offline read). */
  loadMessages: (conversationId: string) => Promise<ChatMessage[]>;
};
