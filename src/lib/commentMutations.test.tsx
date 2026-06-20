// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { IssueDetailResult, LiveDetail } from "./commands";

const { createComment, updateComment, deleteComment, addReaction, removeReaction } = vi.hoisted(() => ({
  createComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  addReaction: vi.fn(),
  removeReaction: vi.fn(),
}));
vi.mock("./commands", async (orig) => ({
  ...(await orig<object>()),
  createComment,
  updateComment,
  deleteComment,
  addReaction,
  removeReaction,
}));
vi.mock("goey-toast", () => ({ gooeyToast: { error: vi.fn(), success: vi.fn() } }));

import { useCreateComment, useAddReaction, useDeleteComment } from "./queries";

afterEach(() => {
  cleanup();
  createComment.mockReset();
  updateComment.mockReset();
  deleteComment.mockReset();
  addReaction.mockReset();
  removeReaction.mockReset();
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData<IssueDetailResult>(["issue", "i1"], {
    source: "live",
    detail: { comments: [] } as unknown as LiveDetail,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("useCreateComment", () => {
  it("optimistically inserts a pending comment, then confirms with the server result", async () => {
    createComment.mockResolvedValue({
      id: "real", body: "hi", userId: "u1", userName: "U", createdAt: "t", editedAt: null, parentId: null, reactions: [],
    });
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useCreateComment(), { wrapper });
    result.current.mutate({ issueId: "i1", body: "hi" });
    // optimistic: a pending comment appears immediately
    await waitFor(() => {
      const d = qc.getQueryData<IssueDetailResult>(["issue", "i1"]);
      expect((d!.detail as LiveDetail).comments).toHaveLength(1);
    });
    // confirmed: temp swapped for the server id
    await waitFor(() => {
      const d = qc.getQueryData<IssueDetailResult>(["issue", "i1"]);
      expect((d!.detail as LiveDetail).comments[0].id).toBe("real");
    });
  });

  it("rolls back the optimistic insert on error", async () => {
    createComment.mockRejectedValue(new Error("boom"));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useCreateComment(), { wrapper });
    result.current.mutate({ issueId: "i1", body: "hi" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    const d = qc.getQueryData<IssueDetailResult>(["issue", "i1"]);
    expect((d!.detail as LiveDetail).comments).toEqual([]);
  });
});

describe("useAddReaction", () => {
  it("optimistically inserts a pending reaction, then onSuccess swaps temp id for server id", async () => {
    addReaction.mockResolvedValue({ id: "server-re", emoji: "👍", userId: "u1", userName: "U" });
    const { qc, wrapper } = setup();
    // Seed a comment with no reactions
    qc.setQueryData<IssueDetailResult>(["issue", "i1"], {
      source: "live",
      detail: {
        comments: [{ id: "c1", body: "b", userId: "u1", userName: "U", createdAt: "t", editedAt: null, parentId: null, reactions: [] }],
      } as unknown as LiveDetail,
    });
    const { result } = renderHook(() => useAddReaction(), { wrapper });
    result.current.mutate({ issueId: "i1", commentId: "c1", emoji: "👍" });
    // optimistic: a pending reaction appears immediately
    await waitFor(() => {
      const d = qc.getQueryData<IssueDetailResult>(["issue", "i1"]);
      expect((d!.detail as LiveDetail).comments[0].reactions).toHaveLength(1);
    });
    // confirmed: temp id swapped for the server id (NOT a pending- id)
    await waitFor(() => {
      const d = qc.getQueryData<IssueDetailResult>(["issue", "i1"]);
      const reactionId = (d!.detail as LiveDetail).comments[0].reactions[0].id;
      expect(reactionId).toBe("server-re");
      expect(reactionId).not.toMatch(/^pending-/);
    });
  });
});

describe("useDeleteComment", () => {
  it("rolls back the optimistic removal on error", async () => {
    deleteComment.mockRejectedValue(new Error("boom"));
    const { qc, wrapper } = setup();
    // Seed a comment to delete
    qc.setQueryData<IssueDetailResult>(["issue", "i1"], {
      source: "live",
      detail: {
        comments: [{ id: "c1", body: "b", userId: "u1", userName: "U", createdAt: "t", editedAt: null, parentId: null, reactions: [] }],
      } as unknown as LiveDetail,
    });
    const { result } = renderHook(() => useDeleteComment(), { wrapper });
    result.current.mutate({ issueId: "i1", id: "c1" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    const d = qc.getQueryData<IssueDetailResult>(["issue", "i1"]);
    expect((d!.detail as LiveDetail).comments).toHaveLength(1);
    expect((d!.detail as LiveDetail).comments[0].id).toBe("c1");
  });
});
