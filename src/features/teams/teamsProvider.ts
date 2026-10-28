import { openUrl } from "@tauri-apps/plugin-opener";
import { getTeamsChatMessages, teamsOpenLink } from "@/lib/commands";
import type { ChatProvider } from "@/features/chat/provider";

/** Microsoft Teams as a chat-board provider: https Teams links, cached reads. */
export const teamsProvider: ChatProvider = {
  name: "Teams",
  openLabel: "Open in Teams",
  open: async (conversationId, messageId) => {
    try {
      await openUrl(await teamsOpenLink(conversationId, messageId ?? null));
    } catch {
      /* sanitized: nothing to open just no-ops */
    }
  },
  loadMessages: (conversationId) => getTeamsChatMessages(conversationId),
};
