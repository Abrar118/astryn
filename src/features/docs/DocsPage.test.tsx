// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DocNode, DocsSource } from "@/lib/commands";

function source(id: string, name: string): DocsSource {
  const [owner, rest] = id.split("/");
  const [repo, branch] = rest.split("@");
  return {
    id,
    name,
    owner,
    repo,
    branch,
    url: `https://github.com/${owner}/${repo}/tree/${branch}`,
    lastSyncedAt: "2026-07-26T10:00:00Z",
    fileCount: 2,
    truncated: false,
  };
}

const CORE = source("acme/core@main", "Core docs");
const DESIGN = source("acme/design@main", "Design system");

const state = vi.hoisted(() => ({
  sources: [] as unknown[],
  tokenPresent: true,
  /** Per-source trees, so we can prove the page reads the source it says it does. */
  trees: {} as Record<string, unknown[]>,
  content: {} as Record<string, string>,
  treeCalls: [] as (string | null)[],
}));

const setActiveView = vi.hoisted(() => vi.fn());

vi.mock("@/lib/queries", () => ({
  useDocsStatus: () => ({ data: { tokenPresent: state.tokenPresent, sourceCount: state.sources.length } }),
  useDocsSources: () => ({ data: state.sources }),
  useDocsTree: (sourceId: string | null) => {
    state.treeCalls.push(sourceId);
    return { data: sourceId ? state.trees[sourceId] : undefined };
  },
  useDocContent: (sourceId: string | null, path: string | null) => ({
    data: sourceId && path ? (state.content[`${sourceId}:${path}`] ?? null) : undefined,
    isPending: false,
  }),
  useDocsSync: () => ({ isError: false, isFetching: false, refetch: vi.fn() }),
}));
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ setActiveView }) }));
vi.mock("./DocViewer", () => ({
  DocViewer: ({ markdown }: { markdown: string }) => <div data-testid="doc">{markdown}</div>,
}));

import { DocsPage } from "./DocsPage";
import { ACTIVE_DOCS_SOURCE_KEY, resetActiveSourceCache } from "./activeSource";
import { takeRequestedSection } from "@/features/settings/settingsSection";

function node(path: string): DocNode {
  return { path, name: path, kind: "blob", parentPath: "" };
}

beforeEach(() => {
  localStorage.clear();
  resetActiveSourceCache();
  takeRequestedSection(); // drain any pending deep-link from a previous test
  setActiveView.mockClear();
  state.sources = [CORE, DESIGN];
  state.tokenPresent = true;
  state.treeCalls = [];
  state.trees = {
    [CORE.id]: [node("README.md")],
    [DESIGN.id]: [node("README.md")],
  };
  state.content = {
    [`${CORE.id}:README.md`]: "# Core",
    [`${DESIGN.id}:README.md`]: "# Design",
  };
});
afterEach(cleanup);

describe("DocsPage source picker", () => {
  it("titles the header with the active source and lists the rest in the menu", () => {
    render(<DocsPage />);
    // With nothing stored yet it falls back to the first source.
    expect(screen.getByRole("button", { name: /core docs/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /core docs/i }));
    expect(screen.getByText("Design system")).toBeTruthy();
    expect(screen.getByText("acme/design · main")).toBeTruthy();
  });

  it("switches the tree to the picked source and remembers the choice", () => {
    render(<DocsPage />);
    expect(screen.getByTestId("doc").textContent).toBe("# Core");

    fireEvent.click(screen.getByRole("button", { name: /core docs/i }));
    fireEvent.click(screen.getByText("Design system"));

    expect(state.treeCalls[state.treeCalls.length - 1]).toBe(DESIGN.id);
    expect(screen.getByTestId("doc").textContent).toBe("# Design");
    // Persisted, so the next Docs tab opens on it too.
    expect(localStorage.getItem(ACTIVE_DOCS_SOURCE_KEY)).toBe(DESIGN.id);
  });

  it("opens on the tab's pinned source rather than the stored default", () => {
    localStorage.setItem(ACTIVE_DOCS_SOURCE_KEY, CORE.id);
    resetActiveSourceCache();
    // A tab opened via "open to the side" stays on the doc's own repo.
    render(<DocsPage docSourceId={DESIGN.id} docPath="README.md" />);
    expect(screen.getByRole("button", { name: /design system/i })).toBeTruthy();
    expect(screen.getByTestId("doc").textContent).toBe("# Design");
  });

  it("falls back to another source when the pinned one was removed", () => {
    // Deleting a source in Settings must not strand an open tab on a dead repo.
    state.sources = [CORE];
    render(<DocsPage docSourceId={DESIGN.id} docPath="README.md" />);
    expect(screen.getByRole("button", { name: /core docs/i })).toBeTruthy();
    // ...and it re-selects the surviving repo's default doc, not the stale path.
    expect(screen.getByTestId("doc").textContent).toBe("# Core");
  });
});

describe("DocsPage empty states", () => {
  it("sends an unconfigured user to the Documentation settings section", () => {
    state.sources = [];
    render(<DocsPage />);
    fireEvent.click(screen.getByRole("button", { name: /add a repository/i }));
    expect(setActiveView).toHaveBeenCalledWith("settings");
    expect(takeRequestedSection()).toBe("documentation");
  });

  it("sends a tokenless user to the GitHub settings section", () => {
    state.tokenPresent = false;
    render(<DocsPage />);
    fireEvent.click(screen.getByRole("button", { name: /connect github/i }));
    expect(setActiveView).toHaveBeenCalledWith("settings");
    expect(takeRequestedSection()).toBe("github");
  });
});
