// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ChatCatchup, TeamsStatus } from "@/lib/commands";

const hooks = vi.hoisted(() => ({
  useTeamsStatus: vi.fn(),
  useTeamsCatchup: vi.fn(),
  useTeamsSync: vi.fn(),
}));
const setActiveView = vi.hoisted(() => vi.fn());
const openUrl = vi.hoisted(() => vi.fn());
const teamsOpenLink = vi.hoisted(() => vi.fn());
const getTeamsChatMessages = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries", () => hooks);
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ setActiveView, openIssueTab: vi.fn() }) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("@/lib/commands", () => ({ teamsOpenLink, getTeamsChatMessages }));

import { TeamsPage } from "./TeamsPage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const empty: ChatCatchup = { conversations: [], mentions: [], threads: [], lastSyncedAt: null };

function setup(status: TeamsStatus, catchup: ChatCatchup = empty, syncEnabled?: (on: boolean) => void) {
  hooks.useTeamsStatus.mockReturnValue({ data: status });
  hooks.useTeamsCatchup.mockReturnValue({ data: catchup });
  hooks.useTeamsSync.mockImplementation((on: boolean) => {
    syncEnabled?.(on);
    return { isFetching: false, isError: false, data: undefined, refetch: vi.fn() };
  });
}

const board: ChatCatchup = {
  ...empty,
  conversations: [
    { id: "19:a@unq.gbl.spaces", kind: "dm", name: "Nick Fury", partnerUserId: null, unreadCount: 2, hasMention: true, unreadThreads: 0, latestTs: "1616964509832", latestSnippet: "can you check ENG-7?" },
  ],
  mentions: [
    { conversationId: "19:a@unq.gbl.spaces", ts: "1616964509832", threadTs: null, userId: "u-2", userName: "Nick Fury", userAvatar: null, text: "Me can you check ENG-7?", isMention: true, linearIdentifier: "ENG-7", linearIssueId: null, createdAt: "2021-03-28T20:48:29.832Z" },
  ],
};

describe("TeamsPage", () => {
  it("prompts to connect and deep-links to Settings when not signed in", () => {
    const syncs: boolean[] = [];
    setup({ state: "not_configured" }, empty, (on) => syncs.push(on));
    render(<TeamsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Teams" }));
    expect(setActiveView).toHaveBeenCalledWith("settings");
    expect(syncs.every((on) => !on)).toBe(true);
  });

  it("shows Mentions and Chats only, and syncs while signed in", () => {
    const syncs: boolean[] = [];
    setup({ state: "connected", userName: "Ada" }, board, (on) => syncs.push(on));
    render(<TeamsPage />);
    expect(screen.getByText("Mentions")).toBeTruthy();
    expect(screen.getByText("Chats")).toBeTruthy();
    expect(screen.queryByText("Threads")).toBeNull();
    expect(screen.queryByText("Channels")).toBeNull();
    expect(screen.getAllByText("Nick Fury").length).toBeGreaterThan(0);
    expect(syncs).toContain(true);
  });

  it("opens the message in Teams through the Rust-built link", async () => {
    setup({ state: "connected", userName: "Ada" }, board);
    teamsOpenLink.mockResolvedValue("https://teams.microsoft.com/l/message/19:a/1616964509832?context=x");
    render(<TeamsPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Open in Teams" })[0]);
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://teams.microsoft.com/l/message/19:a/1616964509832?context=x"));
    expect(teamsOpenLink).toHaveBeenCalledWith("19:a@unq.gbl.spaces", "1616964509832");
  });

  it("expands a chat into the cached reader", async () => {
    setup({ state: "connected", userName: "Ada" }, board);
    getTeamsChatMessages.mockResolvedValue(board.mentions);
    render(<TeamsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Expand Nick Fury" }));
    await waitFor(() => expect(screen.getAllByText("Me can you check ENG-7?").length).toBe(2));
    expect(getTeamsChatMessages).toHaveBeenCalledWith("19:a@unq.gbl.spaces");
  });
});
