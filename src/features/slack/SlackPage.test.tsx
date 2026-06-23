// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SlackCatchup, SlackStatus } from "@/lib/commands";

const hooks = vi.hoisted(() => ({
  useSlackStatus: vi.fn(),
  useSlackCatchup: vi.fn(),
  useSlackSync: vi.fn(),
}));
const setActiveView = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries", () => hooks);
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ setActiveView, openIssueTab: vi.fn() }) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/lib/commands", async (orig) => ({ ...(await orig<typeof import("@/lib/commands")>()) }));

import { SlackPage } from "./SlackPage";

afterEach(cleanup);

const empty: SlackCatchup = { conversations: [], mentions: [], threads: [], lastSyncedAt: null };

function setup(status: SlackStatus, catchup: SlackCatchup = empty) {
  hooks.useSlackStatus.mockReturnValue({ data: status });
  hooks.useSlackCatchup.mockReturnValue({ data: catchup });
  hooks.useSlackSync.mockReturnValue({ isFetching: false, isError: false, data: undefined, refetch: vi.fn() });
}

describe("SlackPage", () => {
  it("shows a connect prompt when not configured", () => {
    setup({ state: "not_configured" });
    render(<SlackPage />);
    expect(screen.getByText("Connect Slack")).toBeTruthy();
  });

  it("renders the four sections when connected", () => {
    setup({ state: "connected", workspaceName: "acme", userName: "U1" }, {
      ...empty,
      conversations: [
        { id: "D1", kind: "dm", name: "Bob", partnerUserId: "U2", unreadCount: 2, hasMention: false, unreadThreads: 0, latestTs: "2.0", latestSnippet: "hey" },
        { id: "C1", kind: "channel", name: "eng", partnerUserId: null, unreadCount: 1, hasMention: true, unreadThreads: 1, latestTs: "3.0", latestSnippet: "ping" },
      ],
      mentions: [
        { conversationId: "C1", ts: "3.0", threadTs: null, userId: "U2", userName: "Bob", userAvatar: null, text: "ping <@U1>", isMention: true, linearIdentifier: null, linearIssueId: null, createdAt: "2026-06-23T00:00:00Z" },
      ],
    });
    render(<SlackPage />);
    expect(screen.getByText("Mentions")).toBeTruthy();
    expect(screen.getByText("Direct messages")).toBeTruthy();
    expect(screen.getByText("Threads")).toBeTruthy();
    expect(screen.getByText("Channels")).toBeTruthy();
  });
});
