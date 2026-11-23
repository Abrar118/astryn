import { describe, expect, it } from "vitest";
import { headingAt, lineOffset, pickHeading } from "./docFocus";

const DOC = "intro\n# A\ntext\n```\n# not a heading\n```\n## B ##\nmore\n";

describe("headingAt", () => {
  it("finds the heading a line falls under and its position", () => {
    expect(headingAt(DOC, 3)).toEqual({ index: 0, text: "A" });
    expect(headingAt(DOC, 8)).toEqual({ index: 1, text: "B" });
  });
  it("ignores # inside code fences", () => {
    expect(headingAt(DOC, 5)).toEqual({ index: 0, text: "A" });
  });
  it("is null before the first heading", () => {
    expect(headingAt(DOC, 1)).toBeNull();
  });
});

describe("lineOffset", () => {
  it("returns where a line starts", () => {
    expect(lineOffset("ab\ncd\nef", 1)).toBe(0);
    expect(lineOffset("ab\ncd\nef", 3)).toBe(6);
    expect(lineOffset("ab", 9)).toBe(2);
  });
});

describe("pickHeading", () => {
  const el = (t: string) => ({ textContent: t }) as HTMLElement;
  it("prefers position, falls back to text, then position", () => {
    const hs = [el("Setup"), el("Setup"), el("Usage")];
    expect(pickHeading(hs, { index: 1, text: "Setup" })).toBe(hs[1]);
    expect(pickHeading(hs, { index: 0, text: "Usage" })).toBe(hs[2]);
    expect(pickHeading(hs, { index: 1, text: "Other" })).toBe(hs[1]);
  });
});
