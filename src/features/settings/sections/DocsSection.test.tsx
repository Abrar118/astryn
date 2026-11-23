// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DocsSource } from "@/lib/commands";

const SOURCE: DocsSource = {
  id: "local:/n",
  kind: "local",
  name: "Notes",
  owner: null,
  repo: null,
  branch: null,
  location: "/n",
  url: null,
  lastSyncedAt: "2026-07-26T10:00:00Z",
  fileCount: 2,
  truncated: false,
  available: true,
};

const reindex = vi.hoisted(() => vi.fn());
const setSemantic = vi.hoisted(() => vi.fn());
const semantic = vi.hoisted(() => ({ current: { enabled: true, modelPresent: true, model: "bge-base-en-v1.5" } }));
vi.mock("@/lib/commands", async (orig) => ({
  ...(await orig<typeof import("@/lib/commands")>()),
  reindexDocs: reindex,
  setSemanticSearch: setSemantic,
}));
vi.mock("@/lib/queries", () => ({
  useDocsSources: () => ({ data: [SOURCE] }),
  useDocsStatus: () => ({ data: { tokenPresent: true, clickupTokenPresent: false, sourceCount: 1 } }),
  useDocsIndexStatus: () => ({ data: [{ sourceId: SOURCE.id, files: 2, chunks: 5, embedded: 3, indexedAt: "now" }] }),
  useSemanticSearch: () => ({ data: semantic.current }),
}));
vi.mock("@/lib/modules", () => ({ useModules: () => ({ isActive: () => true }) }));

import { DocsSection } from "./DocsSection";

afterEach(() => {
  cleanup();
  semantic.current = { enabled: true, modelPresent: true, model: "bge-base-en-v1.5" };
});

function renderSection() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DocsSection />
    </QueryClientProvider>,
  );
}

describe("DocsSection search index", () => {
  it("shows how many sections are searchable per source", () => {
    renderSection();
    expect(screen.getByText(/5 searchable sections/)).toBeTruthy();
  });

  it("says whether a source is keyword-only or hybrid", () => {
    renderSection();
    expect(screen.getByText(/hybrid \(3\/5\)/)).toBeTruthy();
    cleanup();
    semantic.current = { enabled: false, modelPresent: true, model: "bge-base-en-v1.5" };
    renderSection();
    expect(screen.getByText(/5 searchable sections · keyword/)).toBeTruthy();
  });

  it("switches semantic search off", async () => {
    setSemantic.mockResolvedValue({ enabled: false, modelPresent: true, model: "bge-base-en-v1.5" });
    renderSection();
    fireEvent.click(screen.getByRole("switch", { name: "Semantic search" }));
    await waitFor(() => expect(setSemantic).toHaveBeenCalledWith(false));
  });

  it("explains how to install a missing model", () => {
    semantic.current = { enabled: true, modelPresent: false, model: "bge-base-en-v1.5" };
    renderSection();
    expect(screen.getByText(/npm run fetch-model/)).toBeTruthy();
  });

  it("updates the search index on request", async () => {
    reindex.mockResolvedValue({ indexed: 2, skipped: 0, removed: 0 });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /update search/i }));
    await waitFor(() => expect(reindex).toHaveBeenCalled());
  });
});
