import { describe, expect, it } from "vitest";
import { aggregateReactions, REACTION_EMOJI } from "./reactions";
import type { DetailReaction } from "@/lib/commands";

const r = (id: string, emoji: string, userId: string, userName: string): DetailReaction => ({
  id,
  emoji,
  userId,
  userName,
});

describe("aggregateReactions", () => {
  it("groups by emoji with counts, names, and my-reaction state", () => {
    const out = aggregateReactions(
      [r("1", "👍", "u1", "Abrar"), r("2", "👍", "u2", "Jakob"), r("3", "🎉", "u2", "Jakob")],
      "u1",
    );
    expect(out.map((x) => [x.emoji, x.count])).toEqual([["👍", 2], ["🎉", 1]]);
    expect(out[0].reactedByMe).toBe(true);
    expect(out[0].reactionIdByMe).toBe("1");
    expect(out[0].names).toEqual(["Abrar", "Jakob"]);
    expect(out[1].reactedByMe).toBe(false);
    expect(out[1].reactionIdByMe).toBeNull();
  });

  it("exposes 8 quick-set emoji", () => {
    expect(REACTION_EMOJI).toHaveLength(8);
  });
});
