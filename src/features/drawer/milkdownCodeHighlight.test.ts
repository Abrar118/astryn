import { describe, it, expect } from "vitest";
import { resolveLanguage, highlightToReact } from "./milkdownCodeHighlight";

describe("resolveLanguage", () => {
  it("resolves common aliases to grammar names", () => {
    expect(resolveLanguage("ts")).toBe("typescript");
    expect(resolveLanguage("tsx")).toBe("typescript");
    expect(resolveLanguage("js")).toBe("javascript");
    expect(resolveLanguage("sh")).toBe("bash");
    expect(resolveLanguage("yml")).toBe("yaml");
    expect(resolveLanguage("rs")).toBe("rust");
  });
  it("passes through a known canonical name", () => {
    expect(resolveLanguage("python")).toBe("python");
  });
  it("returns null for unknown, empty, or mermaid", () => {
    expect(resolveLanguage("klingon")).toBeNull();
    expect(resolveLanguage("")).toBeNull();
    expect(resolveLanguage(undefined)).toBeNull();
    expect(resolveLanguage("mermaid")).toBeNull();
  });
});

describe("highlightToReact", () => {
  it("returns React elements for a supported language", () => {
    const result = highlightToReact("const x = 1;", "ts");
    expect(typeof result).not.toBe("string");
  });

  it("returns plain text string for unsupported language", () => {
    const result = highlightToReact("hello", "klingon");
    expect(result).toBe("hello");
  });

  it("returns plain text string for undefined language", () => {
    const result = highlightToReact("hello", undefined);
    expect(result).toBe("hello");
  });
});
