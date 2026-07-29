import { describe, expect, it } from "vitest";
import { parseViewConfig, pruneFilters } from "./viewConfig";

describe("parseViewConfig", () => {
  it("accepts valid persisted preferences", () => {
    const config = parseViewConfig(JSON.stringify({ viewMode: "board", filters: { teamId: "t1" } }));
    expect(config.viewMode).toBe("board");
    expect(config.filters).toEqual({ teamId: "t1" });
  });

  it("rejects invalid enum and field types", () => {
    const config = parseViewConfig(JSON.stringify({
      viewMode: "javascript:", showSubIssues: "yes", filters: { teamId: 7 },
      display: { created: "yes" },
    }));
    expect(config.viewMode).toBe("list");
    expect(config.showSubIssues).toBe(true);
    expect(config.filters).toEqual({});
    expect(config.display.created).toBe(false);
  });
});

describe("pruneFilters", () => {
  const known = {
    teams: [{ id: "t1" }],
    projects: [{ id: "p1" }],
    users: [{ id: "u1" }],
  };

  it("drops ids that no longer exist in the workspace", () => {
    // Switching Linear workspaces leaves filters pointing at the old workspace's
    // ids; keeping them silently filters the list down to nothing.
    const pruned = pruneFilters(
      { teamId: "t1", assigneeId: "gone", projectId: "also-gone" },
      known,
    );
    expect(pruned).toEqual({ teamId: "t1" });
  });

  it("keeps filters untouched when every id is known", () => {
    const filters = { teamId: "t1", assigneeId: "u1", projectId: "p1" };
    expect(pruneFilters(filters, known)).toEqual(filters);
  });

  it("leaves filters alone while a list is still loading or failed", () => {
    // An empty/absent list means "not loaded yet" — pruning then would wipe a
    // valid filter on every cold start or offline launch.
    const filters = { teamId: "t1", assigneeId: "u1", projectId: "p1" };
    expect(pruneFilters(filters, { teams: [], projects: [], users: [] })).toEqual(filters);
    expect(pruneFilters(filters, {})).toEqual(filters);
  });

  it("returns the same object when nothing changed, so effects don't loop", () => {
    const filters = { teamId: "t1" };
    expect(pruneFilters(filters, known)).toBe(filters);
  });
});
