// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { DocLink } from "./commands";

const listDocLinks = vi.hoisted(() => vi.fn());
const createDocLink = vi.hoisted(() => vi.fn());
const updateDocLink = vi.hoisted(() => vi.fn());
const deleteDocLink = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const docsOn = vi.hoisted(() => ({ value: true }));

vi.mock("./commands", () => ({
  listDocLinks,
  createDocLink,
  updateDocLink,
  deleteDocLink,
  errorText: (err: unknown) => String(err),
}));
vi.mock("./modules", () => ({ useModules: () => ({ isActive: (id: string) => id === "docs" && docsOn.value }) }));
vi.mock("./queries", () => ({ isModuleOff: (err: unknown) => String(err) === "That module is turned off." }));
vi.mock("goey-toast", () => ({ gooeyToast: { error: toastError } }));

import { docLinksKey, useCreateDocLink, useDeleteDocLink, useDocLinks, useUpdateDocLink } from "./docLinkQueries";

const A: DocLink = {
  id: "dl_a",
  tracker: "linear",
  taskId: "i1",
  kind: "url",
  url: "https://a.com",
  sourceId: null,
  docPath: null,
  title: "A",
  note: null,
  tags: [],
  createdAt: "t1",
  updatedAt: "t1",
};

let qc: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
const KEY = docLinksKey("linear", "i1");

/** A promise the test settles by hand, to observe the optimistic state. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  for (const f of [listDocLinks, createDocLink, updateDocLink, deleteDocLink, toastError]) f.mockReset();
  docsOn.value = true;
});

describe("useDocLinks", () => {
  it("reads one task's links under its tracker-qualified key", async () => {
    listDocLinks.mockResolvedValue([A]);
    const { result } = renderHook(() => useDocLinks("linear", "i1"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([A]));
    expect(listDocLinks).toHaveBeenCalledWith("linear", "i1");
    expect(KEY).toEqual(["doc-links", "linear", "i1"]);
  });

  it("does not run while Docs is off", () => {
    docsOn.value = false;
    renderHook(() => useDocLinks("linear", "i1"), { wrapper });
    expect(listDocLinks).not.toHaveBeenCalled();
  });
});

describe("doc link mutations", () => {
  it("adds a pending row at once and swaps in the saved link", async () => {
    qc.setQueryData(KEY, [A]);
    const saved = deferred<DocLink>();
    createDocLink.mockReturnValue(saved.promise);
    listDocLinks.mockResolvedValue([A, { ...A, id: "dl_b", title: "B" }]);
    const { result } = renderHook(() => useCreateDocLink("linear", "i1"), { wrapper });

    act(() => result.current.mutate({ kind: "url", url: "b.com", title: " B ", tags: ["x"] }));
    await waitFor(() => expect(qc.getQueryData<DocLink[]>(KEY)).toHaveLength(2));
    const pending = qc.getQueryData<DocLink[]>(KEY)![1];
    expect(pending.id.startsWith("pending-")).toBe(true);
    expect(pending).toMatchObject({ kind: "url", url: "b.com", title: "B", tags: ["x"], taskId: "i1" });

    await act(async () => saved.resolve({ ...A, id: "dl_b", title: "B" }));
    await waitFor(() => expect(qc.getQueryData<DocLink[]>(KEY)!.map((l) => l.id)).toEqual(["dl_a", "dl_b"]));
    expect(createDocLink).toHaveBeenCalledWith("linear", "i1", { kind: "url", url: "b.com", title: " B ", tags: ["x"] });
  });

  it("rolls a failed add back and says why", async () => {
    qc.setQueryData(KEY, [A]);
    createDocLink.mockRejectedValue("That doesn't look like a valid URL.");
    listDocLinks.mockResolvedValue([A]);
    const { result } = renderHook(() => useCreateDocLink("linear", "i1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ kind: "url", url: "nope", tags: [] }).catch(() => {});
    });
    expect(qc.getQueryData<DocLink[]>(KEY)).toEqual([A]);
    expect(toastError).toHaveBeenCalledWith("Couldn't add link", { description: "That doesn't look like a valid URL." });
  });

  it("edits in place and rolls back on failure", async () => {
    qc.setQueryData(KEY, [A]);
    const done = deferred<DocLink>();
    updateDocLink.mockReturnValue(done.promise);
    listDocLinks.mockResolvedValue([A]);
    const { result } = renderHook(() => useUpdateDocLink("linear", "i1"), { wrapper });

    act(() => result.current.mutate({ id: "dl_a", input: { kind: "url", url: "https://a.com", note: "  read me ", tags: [] } }));
    await waitFor(() => expect(qc.getQueryData<DocLink[]>(KEY)![0].note).toBe("read me"));
    await act(async () => done.reject("That link no longer exists."));
    await waitFor(() => expect(qc.getQueryData<DocLink[]>(KEY)).toEqual([A]));
    expect(toastError).toHaveBeenCalledWith("Couldn't save link", { description: "That link no longer exists." });
  });

  it("removes at once and restores the row when the delete fails", async () => {
    qc.setQueryData(KEY, [A]);
    const done = deferred<void>();
    deleteDocLink.mockReturnValue(done.promise);
    listDocLinks.mockResolvedValue([A]);
    const { result } = renderHook(() => useDeleteDocLink("linear", "i1"), { wrapper });

    act(() => result.current.mutate("dl_a"));
    await waitFor(() => expect(qc.getQueryData<DocLink[]>(KEY)).toEqual([]));
    await act(async () => done.reject("Internal error."));
    await waitFor(() => expect(qc.getQueryData<DocLink[]>(KEY)).toEqual([A]));
    expect(toastError).toHaveBeenCalledWith("Couldn't remove link", { description: "Internal error." });
  });

  it("stays quiet when Docs was switched off mid-flight", async () => {
    qc.setQueryData(KEY, [A]);
    deleteDocLink.mockRejectedValue("That module is turned off.");
    const { result } = renderHook(() => useDeleteDocLink("linear", "i1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("dl_a").catch(() => {});
    });
    expect(toastError).not.toHaveBeenCalled();
    expect(qc.getQueryData<DocLink[]>(KEY)).toEqual([A]);
  });
});
