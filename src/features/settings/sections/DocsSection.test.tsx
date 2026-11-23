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
vi.mock("@/lib/commands", async (orig) => ({
  ...(await orig<typeof import("@/lib/commands")>()),
  reindexDocs: reindex,
}));
vi.mock("@/lib/queries", () => ({
  useDocsSources: () => ({ data: [SOURCE] }),
  useDocsStatus: () => ({ data: { tokenPresent: true, clickupTokenPresent: false, sourceCount: 1 } }),
  useDocsIndexStatus: () => ({ data: [{ sourceId: SOURCE.id, files: 2, chunks: 5, indexedAt: "now" }] }),
}));
vi.mock("@/lib/modules", () => ({ useModules: () => ({ isActive: () => true }) }));

import { DocsSection } from "./DocsSection";

afterEach(cleanup);

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

  it("updates the search index on request", async () => {
    reindex.mockResolvedValue({ indexed: 2, skipped: 0, removed: 0 });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /update search/i }));
    await waitFor(() => expect(reindex).toHaveBeenCalled());
  });
});
