import { describe, expect, it } from "vitest";
import { parseViewConfig } from "./viewConfig";

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
