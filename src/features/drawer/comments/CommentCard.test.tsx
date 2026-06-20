// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DetailComment } from "@/lib/commands";

const { meId } = vi.hoisted(() => ({ meId: { value: "u1" } }));
const deleteMutate = vi.fn();
vi.mock("@/lib/queries", () => ({
  useMe: () => ({ data: { viewerId: meId.value, viewerName: "Me" } }),
  useUpdateComment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteComment: () => ({ mutate: deleteMutate }),
  useAddReaction: () => ({ mutate: vi.fn() }),
  useRemoveReaction: () => ({ mutate: vi.fn() }),
  useCreateComment: () => ({ mutate: vi.fn(), isPending: false }),
}));
// Read-only render path stubbed to plain text (avoids react-markdown internals here).
vi.mock("../DescriptionEditor", () => ({ ReadOnlyDescription: ({ markdown }: { markdown: string }) => <div>{markdown}</div> }));

import { CommentCard } from "./CommentCard";

const base: DetailComment = {
  id: "c1", body: "the body", userId: "u1", userName: "Abrar",
  createdAt: "2026-06-19T10:00:00Z", editedAt: "2026-06-19T10:05:00Z", parentId: null,
  reactions: [{ id: "r1", emoji: "👍", userId: "u2", userName: "Jakob" }],
};

afterEach(() => { cleanup(); meId.value = "u1"; deleteMutate.mockClear(); });

describe("CommentCard", () => {
  it("shows the (edited) marker and a reaction pill with its count", () => {
    render(<CommentCard comment={base} issueId="i1" onOpenLink={vi.fn()} />);
    expect(screen.getByText(/\(edited\)/)).toBeTruthy();
    expect(screen.getByText("👍")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("exposes the edit/delete menu only to the author", () => {
    const { rerender } = render(<CommentCard comment={base} issueId="i1" onOpenLink={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /comment actions/i })).not.toBeNull();
    meId.value = "someone-else";
    rerender(<CommentCard comment={base} issueId="i1" onOpenLink={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /comment actions/i })).toBeNull();
  });

  it("first Delete click arms confirm without calling mutate", () => {
    render(<CommentCard comment={base} issueId="i1" onOpenLink={vi.fn()} />);

    // Open the … menu
    fireEvent.click(screen.getByRole("button", { name: /comment actions/i }));
    // Click "Delete" — should arm confirm, not mutate
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(deleteMutate).not.toHaveBeenCalled();
    // "Confirm delete" button should now be visible
    expect(screen.getByRole("button", { name: /confirm delete/i })).toBeTruthy();
  });

  it("second click on Confirm delete calls mutate", () => {
    render(<CommentCard comment={base} issueId="i1" onOpenLink={vi.fn()} />);

    // Open menu, click Delete, then Confirm delete
    fireEvent.click(screen.getByRole("button", { name: /comment actions/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    expect(deleteMutate).toHaveBeenCalledOnce();
    expect(deleteMutate).toHaveBeenCalledWith({ issueId: "i1", id: "c1" });
  });
});
