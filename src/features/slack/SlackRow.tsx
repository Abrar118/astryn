import type { SlackConversation, SlackMessage, SlackThread } from "@/lib/commands";
import { ChatConversationRow, ChatMentionRow, ChatThreadRow } from "@/features/chat/ChatRows";
import { slackProvider } from "./slackProvider";

export function SlackRow({ conv }: { conv: SlackConversation }) {
  return <ChatConversationRow conv={conv} provider={slackProvider} />;
}

export function SlackMentionRow({ msg, convName }: { msg: SlackMessage; convName: string }) {
  return <ChatMentionRow msg={msg} convName={convName} provider={slackProvider} />;
}

export function SlackThreadRow({ thread }: { thread: SlackThread }) {
  return <ChatThreadRow thread={thread} provider={slackProvider} />;
}
