// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Notification } from "@/lib/commands";

const hooks = vi.hoisted(() => ({
  useNotifications: vi.fn(),
  useConnectionStatus: vi.fn(() => ({ data: { state: "connected", name: "Lee" } })),
  useIssueDetail: vi.fn(() => ({ data: undefined, isError: false, isLoading: true, refetch: vi.fn() })),
}));
vi.mock("@/lib/queries", () => hooks);
vi.mock("@/features/drawer/IssueDrawer", () => ({ IssueDetail: () => null }));
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ setActiveView: vi.fn() }) }));

import { InboxView } from "./InboxView";

afterEach(cleanup);

const note = (id: string, over: Partial<Notification> = {}): Notification => ({
  id, kind: "issueNewComment", createdAt: "2026-10-29T08:00:00Z", read: false, actorName: "Lee",
  issueId: `issue-${id}`, issueIdentifier: `ENG-${id}`, issueTitle: `Title ${id}`,
  issueStateType: "started", issueStateColor: "#f2c94c", issueProjectName: null, ...over,
});

function setup(notifications: Notification[]) {
  hooks.useNotifications.mockReturnValue({
    data: { notifications, hasMore: false }, isLoading: false, isError: false, refetch: vi.fn(),
  });
}

describe("InboxView", () => {
  it("counts unread and names unread rows for assistive tech", () => {
    setup([note("1"), note("2", { read: true })]);
    render(<InboxView />);
    expect(screen.getByText("1 unread")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Unread: ENG-1 Title 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^ENG-2 Title 2/ })).toBeInTheDocument();
  });

  it("moves through the list with j / k and opens with a click", () => {
    setup([note("1"), note("2"), note("3")]);
    render(<InboxView />);
    const rows = screen.getAllByRole("button", { name: /ENG-/ });
    expect(rows.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "j" });
    expect(rows[1]).toHaveFocus();
    fireEvent.keyDown(rows[1], { key: "End" });
    expect(rows[2]).toHaveFocus();
    fireEvent.keyDown(rows[2], { key: "k" });
    expect(rows[1]).toHaveFocus();
    fireEvent.click(rows[1]);
    expect(rows[1]).toHaveAttribute("aria-current", "true");
  });

  it("offers a retry when notifications cannot be read", () => {
    const refetch = vi.fn();
    hooks.useNotifications.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    render(<InboxView />);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });
});
