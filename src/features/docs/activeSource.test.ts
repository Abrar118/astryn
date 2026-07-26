// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { DocsSource } from "@/lib/commands";
import {
  ACTIVE_DOCS_SOURCE_KEY,
  loadActiveSourceId,
  resetActiveSourceCache,
  resolveActiveSource,
  saveActiveSourceId,
} from "./activeSource";

function source(id: string, name = id): DocsSource {
  const [owner, rest] = id.split("/");
  const [repo, branch] = rest.split("@");
  return {
    id,
    name,
    owner,
    repo,
    branch,
    url: `https://github.com/${owner}/${repo}/tree/${branch}`,
    lastSyncedAt: null,
    fileCount: 0,
    truncated: false,
  };
}

const core = source("acme/core@main", "Core");
const design = source("acme/design@main", "Design");

describe("resolveActiveSource", () => {
  it("returns nothing when no sources are configured", () => {
    expect(resolveActiveSource([], null)).toBeNull();
    expect(resolveActiveSource([], "acme/core@main")).toBeNull();
  });

  it("honours the stored preference", () => {
    expect(resolveActiveSource([core, design], design.id)).toBe(design);
  });

  it("falls back to the first source before anything has been chosen", () => {
    expect(resolveActiveSource([core, design], null)).toBe(core);
  });

  it("falls back when the stored source has been removed", () => {
    // Deleting the active source in Settings must not strand the page on nothing.
    expect(resolveActiveSource([core, design], "acme/deleted@main")).toBe(core);
  });
});

describe("stored source id", () => {
  beforeEach(() => {
    localStorage.clear();
    resetActiveSourceCache();
  });

  it("is null until a source is chosen", () => {
    expect(loadActiveSourceId()).toBeNull();
  });

  it("round-trips through localStorage", () => {
    saveActiveSourceId(design.id);
    expect(loadActiveSourceId()).toBe(design.id);
    expect(localStorage.getItem(ACTIVE_DOCS_SOURCE_KEY)).toBe(design.id);

    // A fresh session reads it back from storage.
    resetActiveSourceCache();
    expect(loadActiveSourceId()).toBe(design.id);
  });
});
