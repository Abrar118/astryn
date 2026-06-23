// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SlackMessage } from "@/lib/commands";

const openUrl = vi.hoisted(() => vi.fn());
const openIssueTab = vi.hoisted(() => vi.fn());
const slackDeepLink = vi.hoisted(() => vi.fn());
const getSlackConversationMessages = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ openIssueTab }) }));
vi.mock("@/lib/commands", () => ({ slackDeepLink, getSlackConversationMessages }));

import { SlackMentionRow } from "./SlackRow";

afterEach(() => { cleanup(); openUrl.mockReset(); openIssueTab.mockReset(); slackDeepLink.mockReset(); });

const mention: SlackMessage = {
  conversationId: "C1", ts: "3.0", threadTs: null, userId: "U2", userName: "Bob", userAvatar: null,
  text: "ping <@U1> re ENG-7", isMention: true, linearIdentifier: "ENG-7", linearIssueId: "iss-7", createdAt: "2026-06-23T00:00:00Z",
};

describe("SlackMentionRow", () => {
  it("opens the Linear issue tab from the chip", () => {
    render(<SlackMentionRow msg={mention} convName="eng" />);
    fireEvent.click(screen.getByRole("button", { name: "Open ENG-7" }));
    expect(openIssueTab).toHaveBeenCalledWith("iss-7");
  });

  it("opens Slack via the deep link", async () => {
    slackDeepLink.mockResolvedValueOnce({ app: "slack://channel?team=T1&id=C1&message=3.0", web: "https://acme.slack.com/archives/C1/p30" });
    render(<SlackMentionRow msg={mention} convName="eng" />);
    fireEvent.click(screen.getByRole("button", { name: "Open in Slack" }));
    expect(slackDeepLink).toHaveBeenCalledWith("C1", "3.0");
  });
});
