import { describe, expect, it } from "vitest";
import { readableInk, tint } from "./eventStyle";

describe("tint", () => {
  it("converts a hex color to rgba at the given alpha", () => {
    expect(tint("#3b82f6", 0.2)).toBe("rgba(59, 130, 246, 0.2)");
  });

  it("tolerates a missing leading hash", () => {
    expect(tint("3b82f6", 1)).toBe("rgba(59, 130, 246, 1)");
  });

  it("passes non-hex values through untouched", () => {
    expect(tint("currentColor", 0.2)).toBe("currentColor");
  });
});

describe("readableInk", () => {
  it("uses dark ink on a bright fill", () => {
    expect(readableInk("#eab308")).toBe("#0b0b0f");
  });

  it("uses light ink on a dark fill", () => {
    expect(readableInk("#1f2937")).toBe("#f8fafc");
  });

  it("falls back to light ink when the color is not hex", () => {
    expect(readableInk("var(--accent)")).toBe("#f8fafc");
  });
});
