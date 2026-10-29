// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DocLink, DocNode, DocsSource } from "@/lib/commands";

const state = vi.hoisted(() => ({
  links: [] as unknown[] | undefined,
  sources: [] as unknown[],
  trees: {} as Record<string, unknown[]>,
}));
const create = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());
const openDocTab = vi.hoisted(() => vi.fn());
const openUrl = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@/lib/docLinkQueries", () => ({
  useDocLinks: () => ({ data: state.links, isError: false }),
  useCreateDocLink: () => ({ mutateAsync: create, isPending: false }),
  useUpdateDocLink: () => ({ mutateAsync: update, isPending: false }),
  useDeleteDocLink: () => ({ mutate: remove }),
}));
vi.mock("@/lib/queries", () => ({
  useDocsSources: () => ({ data: state.sources }),
  useDocsTree: (id: string | null) => ({ data: id ? state.trees[id] : undefined, isError: false }),
}));
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ openDocTab, setActiveView: vi.fn() }) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("goey-toast", () => ({ gooeyToast: { error: vi.fn() } }));

import { DocLinksPanel } from "./DocLinksPanel";

const DOCS: DocsSource = {
  id: "acme/docs@main",
  kind: "github",
  name: "Platform docs",
  owner: "acme",
  repo: "docs",
  branch: "main",
  location: null,
  url: null,
  lastSyncedAt: null,
  fileCount: 2,
  truncated: false,
  available: true,
};
const TREE: DocNode[] = [
  { path: "guide", name: "guide", kind: "tree", parentPath: "" },
  { path: "guide/setup.md", name: "setup.md", kind: "blob", parentPath: "guide" },
  { path: "README.md", name: "README.md", kind: "blob", parentPath: "" },
];

function link(over: Partial<DocLink>): DocLink {
  return {
    id: "dl_1",
    tracker: "linear",
    taskId: "i1",
    kind: "url",
    url: "https://example.com/spec",
    sourceId: null,
    docPath: null,
    title: "Auth spec",
    note: null,
    tags: [],
    createdAt: "t",
    updatedAt: "t",
    ...over,
  };
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  state.links = [];
  state.sources = [DOCS];
  state.trees = { [DOCS.id]: TREE };
  for (const f of [create, update, remove, openDocTab, openUrl]) f.mockClear();
  create.mockResolvedValue(undefined);
  update.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("DocLinksPanel", () => {
  it("shows an empty state with an Add action", () => {
    render(<DocLinksPanel tracker="linear" taskId="i1" />);
    expect(screen.getByRole("heading", { name: "Docs & links" })).toBeTruthy();
    expect(screen.getByText(/No docs or links yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });

  it("adds a web link with a title, note and tags", async () => {
    render(<DocLinksPanel tracker="linear" taskId="i1" />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const submit = screen.getByRole("button", { name: "Add link" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    type("URL", " example.com/spec ");
    type("Title", "Auth spec");
    type("Note", "Read before review");
    type("Tags", "auth, review, Auth");
    fireEvent.click(submit);
    expect(create).toHaveBeenCalledWith({
      kind: "url",
      url: "example.com/spec",
      title: "Auth spec",
      note: "Read before review",
      tags: ["auth", "review"],
    });
    await waitFor(() => expect(screen.queryByRole("form", { name: "Add a link" })).toBeNull());
  });

  it("adds a doc from a source with the keyboard, titled after the document", () => {
    render(<DocLinksPanel tracker="local-tasks" taskId="lt_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Doc" }));
    const find = screen.getByRole("combobox", { name: "Find a document" });
    fireEvent.change(find, { target: { value: "set" } });
    const list = screen.getByRole("listbox", { name: "Documents" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["setupguide"]);
    fireEvent.keyDown(find, { key: "Enter" });
    expect(within(list).getByRole("option", { name: /setup/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    expect(create).toHaveBeenCalledWith({
      kind: "doc",
      sourceId: DOCS.id,
      docPath: "guide/setup.md",
      title: "setup",
      note: null,
      tags: [],
    });
  });

  it("says when a repository has nothing cached yet", () => {
    state.trees = { [DOCS.id]: [] };
    render(<DocLinksPanel tracker="linear" taskId="i1" />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Doc" }));
    expect(screen.getByText(/Nothing cached yet/)).toBeTruthy();
  });

  it("opens web links in the browser and docs in a Docs tab", () => {
    state.links = [
      link({}),
      link({ id: "dl_2", kind: "doc", url: null, sourceId: DOCS.id, docPath: "guide/setup.md", title: "Setup", tags: ["ops"] }),
    ];
    const onNavigate = vi.fn();
    render(<DocLinksPanel tracker="linear" taskId="i1" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Auth spec" }));
    expect(openUrl).toHaveBeenCalledWith("https://example.com/spec");
    expect(screen.getByText("Platform docs · guide/setup.md")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Tags" })).getByText("ops")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Setup" }));
    expect(openDocTab).toHaveBeenCalledWith(DOCS.id, "guide/setup.md");
    expect(onNavigate).toHaveBeenCalled();
  });

  it("keeps a link to a removed source but does not open it", () => {
    state.links = [link({ kind: "doc", url: null, sourceId: "gone@main", docPath: "a.md", title: "Old spec" })];
    render(<DocLinksPanel tracker="linear" taskId="i1" />);
    expect(screen.getByText(/Source removed/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Old spec" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Remove Old spec" })).toBeTruthy();

    // Its note can still be edited without re-picking a document.
    fireEvent.click(screen.getByRole("button", { name: "Edit Old spec" }));
    expect(screen.getByText(/source was removed/)).toBeTruthy();
    type("Note", "archived");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(update).toHaveBeenCalledWith({
      id: "dl_1",
      input: { kind: "doc", sourceId: "gone@main", docPath: "a.md", title: "Old spec", note: "archived", tags: [] },
    });
  });

  it("edits a link in place, then hands focus back to that row", async () => {
    state.links = [link({ note: "old" })];
    render(<DocLinksPanel tracker="linear" taskId="i1" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Auth spec" }));
    expect((screen.getByLabelText("URL") as HTMLInputElement).value).toBe("https://example.com/spec");
    type("Note", "new");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(update).toHaveBeenCalledWith({
      id: "dl_1",
      input: { kind: "url", url: "https://example.com/spec", title: "Auth spec", note: "new", tags: [] },
    });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Auth spec" })));
  });

  it("moves focus to the next row after a remove, or to Add after the last one", () => {
    state.links = [link({}), link({ id: "dl_2", url: "https://b.com", title: "Second" })];
    render(<DocLinksPanel tracker="linear" taskId="i1" />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Auth spec" }));
    expect(remove).toHaveBeenCalledWith("dl_1");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Second" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Second" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add" }));
  });

  it("checks the input before sending and keeps everything typed", () => {
    render(<DocLinksPanel tracker="linear" taskId="i1" />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    type("URL", "hello world");
    type("Note", "keep me");
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/web address/);
    expect((screen.getByLabelText("Note") as HTMLTextAreaElement).value).toBe("keep me");

    type("URL", "https://x.com");
    type("Tags", Array.from({ length: 21 }, (_, i) => `t${i}`).join(","));
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/20 tags/);
  });

  it("keeps the form open with its values when saving fails", async () => {
    create.mockRejectedValue("That link is already on this task.");
    render(<DocLinksPanel tracker="linear" taskId="i1" />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    type("URL", "https://x.com");
    type("Title", "Spec");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add link" })));
    expect(create).toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("That link is already on this task.");
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Spec");
  });

  it("picks the first source once sources finish loading", () => {
    state.sources = undefined as unknown as unknown[];
    const { rerender } = render(<DocLinksPanel tracker="linear" taskId="i1" />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Doc" }));
    expect(screen.getByText("Loading sources…")).toBeTruthy();
    state.sources = [DOCS];
    rerender(<DocLinksPanel tracker="linear" taskId="i1" />);
    expect((screen.getByLabelText("Docs source") as HTMLSelectElement).value).toBe(DOCS.id);
    expect(within(screen.getByRole("listbox", { name: "Documents" })).getAllByRole("option")).toHaveLength(2);
  });

  it("says so when every source is unavailable", () => {
    state.sources = [{ ...DOCS, available: false }];
    render(<DocLinksPanel tracker="linear" taskId="i1" />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Doc" }));
    expect(screen.queryByText("No docs sources yet.")).toBeNull();
    expect(screen.getByText(/can't be read right now/)).toBeTruthy();
  });

  it("cancels the form with Escape and hands focus back to Add", () => {
    render(<DocLinksPanel tracker="linear" taskId="i1" />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.keyDown(screen.getByLabelText("URL"), { key: "Escape" });
    expect(screen.queryByLabelText("URL")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add" }));
  });
});
