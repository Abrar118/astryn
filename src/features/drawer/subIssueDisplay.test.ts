import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBISSUE_DISPLAY,
  parseSubIssueDisplay,
} from "./subIssueDisplay";

describe("parseSubIssueDisplay", () => {
  it("falls back to defaults for null/garbage", () => {
    expect(parseSubIssueDisplay(null)).toEqual(DEFAULT_SUBISSUE_DISPLAY);
    expect(parseSubIssueDisplay("{not json")).toEqual(DEFAULT_SUBISSUE_DISPLAY);
  });

  it("round-trips valid ordering/completed and per-key display toggles", () => {
    const raw = JSON.stringify({
      ordering: "dueDate",
      completed: "active",
      display: { status: true, created: true, project: false },
    });
    const cfg = parseSubIssueDisplay(raw);
    expect(cfg.ordering).toBe("dueDate");
    expect(cfg.completed).toBe("active");
    expect(cfg.display.status).toBe(true);
    expect(cfg.display.created).toBe(true);
    expect(cfg.display.project).toBe(false);
    // unspecified keys keep the default
    expect(cfg.display.priority).toBe(DEFAULT_SUBISSUE_DISPLAY.display.priority);
  });

  it("rejects an invalid ordering value, keeping the default", () => {
    expect(parseSubIssueDisplay(JSON.stringify({ ordering: "bogus" })).ordering).toBe(
      DEFAULT_SUBISSUE_DISPLAY.ordering,
    );
  });
});
