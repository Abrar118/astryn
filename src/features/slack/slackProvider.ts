import { openUrl } from "@tauri-apps/plugin-opener";
import { getSlackConversationMessages, slackDeepLink } from "@/lib/commands";
import type { ChatProvider } from "@/features/chat/provider";

/** Slack as a chat-board provider: deep links into the desktop app, cached reads. */
export const slackProvider: ChatProvider = {
  name: "Slack",
  openLabel: "Open in Slack",
  open: async (conversationId, ts) => {
    try {
      const link = await slackDeepLink(conversationId, ts ?? null);
      await openUrl(link.app);
    } catch {
      /* sanitized: a missing identity just no-ops the open */
    }
  },
  loadMessages: (conversationId) => getSlackConversationMessages(conversationId),
};
