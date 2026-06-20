// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DetailComment } from "@/lib/commands";

const { meId } = vi.hoisted(() => ({ meId: { value: "u1" } }));
vi.mock("@/lib/queries", () => ({
  useMe: () => ({ data: { viewerId: meId.value, viewerName: "Me" } }),
  useUpdateComment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteComment: () => ({ mutate: vi.fn() }),
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

afterEach(() => { cleanup(); meId.value = "u1"; });

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
});
