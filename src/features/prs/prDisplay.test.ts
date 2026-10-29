import { describe, expect, it } from "vitest";
import type { PrReviewer } from "@/lib/commands";
import { waitingLabel, reviewSummary, daysSince } from "./prDisplay";

describe("waitingLabel", () => {
  const base = Date.parse("2026-06-20T00:00:00Z");
  it("returns null for missing/invalid", () => {
    expect(waitingLabel(null, base)).toBeNull();
    expect(waitingLabel("not-a-date", base)).toBeNull();
  });
  it("escalates by age", () => {
    expect(waitingLabel("2026-06-19T23:00:00Z", base)).toEqual({ short: "1h", level: "normal" });
    expect(waitingLabel("2026-06-17T00:00:00Z", base)?.level).toBe("warn"); // 3d
    expect(waitingLabel("2026-06-10T00:00:00Z", base)?.level).toBe("stale"); // 10d
  });
});

describe("reviewSummary", () => {
  const reviewers: PrReviewer[] = [
    { login: "a", avatar: null, state: "approved" },
    { login: "me", avatar: null, state: "changes_requested" },
    { login: "c", avatar: null, state: "pending" },
  ];
  it("tallies states", () => {
    const s = reviewSummary(reviewers);
    expect(s.approved).toBe(1);
    expect(s.changesRequested).toBe(1);
    expect(s.pending).toBe(1);
    expect(s.viewer).toBeNull();
  });
  it("surfaces the viewer's own state", () => {
    expect(reviewSummary(reviewers, "me").viewer).toBe("changes_requested");
  });
});

describe("daysSince", () => {
  const now = Date.parse("2026-06-20T00:00:00Z");
  it("returns whole days, null for missing", () => {
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince("2026-06-18T00:00:00Z", now)).toBe(2);
  });
});
