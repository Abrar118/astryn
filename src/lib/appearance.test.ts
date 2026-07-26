import { describe, it, expect } from "vitest";
import { clampAppearance, DEFAULT_APPEARANCE, parseAppearance } from "./appearance";

describe("parseAppearance", () => {
  it("accepts valid scales and clamps out-of-range ones", () => {
    expect(parseAppearance('{"appZoom":1.2,"iconScale":1.5,"editorScale":0.8}')).toEqual({
      appZoom: 1.2,
      iconScale: 1.5,
      editorScale: 0.8,
    });
    expect(parseAppearance('{"appZoom":9,"iconScale":0.1,"editorScale":2}')).toEqual({
      appZoom: 1.4,
      iconScale: 0.8,
      editorScale: 1.6,
    });
  });

  it("falls back per field on junk, and wholesale on malformed JSON", () => {
    expect(parseAppearance('{"appZoom":"big","iconScale":null,"editorScale":1.2}')).toEqual({
      ...DEFAULT_APPEARANCE,
      editorScale: 1.2,
    });
    for (const raw of [null, "nope", "[1,2]", '"x"']) {
      expect(parseAppearance(raw)).toEqual(DEFAULT_APPEARANCE);
    }
  });
});

describe("clampAppearance", () => {
  it("snaps to the step grid without float drift", () => {
    expect(clampAppearance("appZoom", 1.05 + 0.05)).toBe(1.1);
    expect(clampAppearance("editorScale", 1.1500000000000001)).toBe(1.15);
  });

  it("clamps to the field's range", () => {
    expect(clampAppearance("appZoom", 3)).toBe(1.4);
    expect(clampAppearance("iconScale", 0)).toBe(0.8);
  });
});
