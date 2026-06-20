import { describe, it, expect } from "vitest";
import { emojiGlyph } from "./reactionEmoji";

describe("emojiGlyph", () => {
  it("maps known shortcode name to glyph", () => {
    expect(emojiGlyph("heart")).toBe("❤️");
    expect(emojiGlyph("+1")).toBe("👍");
  });

  it("passes through already-a-glyph string", () => {
    expect(emojiGlyph("❤️")).toBe("❤️");
    expect(emojiGlyph("👍")).toBe("👍");
  });

  it("wraps unknown shortcodes in colons", () => {
    expect(emojiGlyph("unknown_emoji")).toBe(":unknown_emoji:");
  });
});
