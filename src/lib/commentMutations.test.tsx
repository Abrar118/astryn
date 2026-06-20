// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { IssueDetailResult, LiveDetail } from "./commands";

const { createComment } = vi.hoisted(() => ({ createComment: vi.fn() }));
vi.mock("./commands", async (orig) => ({ ...(await orig<object>()), createComment }));
vi.mock("goey-toast", () => ({ gooeyToast: { error: vi.fn(), success: vi.fn() } }));

import { useCreateComment } from "./queries";

afterEach(() => { cleanup(); createComment.mockReset(); });

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
