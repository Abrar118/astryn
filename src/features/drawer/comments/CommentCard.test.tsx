// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AuthorActionsMenu } from "./CommentCard";
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
  useUsers: () => ({ data: [] }),
}));
vi.mock("goey-toast", () => ({ gooeyToast: { success: vi.fn(), error: vi.fn() } }));
import { gooeyToast } from "goey-toast";
// Read-only render path stubbed to plain text (avoids react-markdown internals here).
vi.mock("../DescriptionEditor", () => ({ ReadOnlyDescription: ({ markdown }: { markdown: string }) => <div>{markdown}</div> }));

import { CommentCard } from "./CommentCard";

const base: DetailComment = {
  id: "c1", body: "the body", quotedText: null, userId: "u1", userName: "Abrar",
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

  it("second click on Confirm delete calls mutate with onSuccess callback", () => {
    render(<CommentCard comment={base} issueId="i1" onOpenLink={vi.fn()} />);

    // Open menu, click Delete, then Confirm delete
    fireEvent.click(screen.getByRole("button", { name: /comment actions/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    expect(deleteMutate).toHaveBeenCalledOnce();
    expect(deleteMutate).toHaveBeenCalledWith(
      { issueId: "i1", id: "c1" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("success toast is NOT shown synchronously on confirm-delete click", () => {
    const successMock = vi.mocked(gooeyToast.success);
    successMock.mockClear();

    render(<CommentCard comment={base} issueId="i1" onOpenLink={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /comment actions/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));

    // mutate was called but mocked — it never invokes onSuccess, so toast should not fire
    expect(successMock).not.toHaveBeenCalled();
  });

  it("success toast is shown after delete mutation succeeds", () => {
    const successMock = vi.mocked(gooeyToast.success);
    successMock.mockClear();

    render(<CommentCard comment={base} issueId="i1" onOpenLink={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /comment actions/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));

    // Extract and invoke the onSuccess callback
    const onSuccessCallback = deleteMutate.mock.calls[0][1].onSuccess;
    onSuccessCallback();

    // Toast should now be called with the success message
    expect(successMock).toHaveBeenCalledOnce();
    expect(successMock).toHaveBeenCalledWith("Comment deleted");
  });

  it("confirm state resets when AuthorActionsMenu unmounts (popover dismissed)", () => {
    // Simulate the Popover unmount-on-close: mount AuthorActionsMenu fresh (as the
    // Popover does each time it opens), arm it, unmount, remount — must start at "Delete".
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const close = vi.fn();

    const { unmount } = render(
      <AuthorActionsMenu close={close} onEdit={onEdit} onDelete={onDelete} />,
    );
    // Arm the confirm state
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(screen.getByRole("button", { name: /confirm delete/i })).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();

    // Simulate Popover closing: unmount the component
    unmount();

    // Simulate Popover reopening: render a fresh AuthorActionsMenu in a new root
    render(<AuthorActionsMenu close={close} onEdit={onEdit} onDelete={onDelete} />);

    // Must show "Delete", not "Confirm delete", and mutate must still not have been called
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /confirm delete/i })).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
