import { describe, it, expect } from "vitest";
import { parseHttpUrl, hostLabel, classifyUrlParagraph } from "./urlPreview";

describe("parseHttpUrl", () => {
  it("accepts a single http(s) URL", () => {
    expect(parseHttpUrl("https://example.com/x")?.href).toBe("https://example.com/x");
    expect(parseHttpUrl("  http://a.test/y  ")?.href).toBe("http://a.test/y");
  });
  it("rejects non-http, multi-token, and empty", () => {
    expect(parseHttpUrl("ftp://x")).toBeNull();
    expect(parseHttpUrl("https://a.com and text")).toBeNull();
    expect(parseHttpUrl("just words")).toBeNull();
    expect(parseHttpUrl("")).toBeNull();
  });
});

describe("hostLabel", () => {
  it("strips www and returns host", () => {
    expect(hostLabel("https://www.github.com/foo")).toBe("github.com");
    expect(hostLabel("https://news.ycombinator.com")).toBe("news.ycombinator.com");
  });
});

describe("classifyUrlParagraph", () => {
  it("bare URL with no mark is a preview", () => {
    expect(classifyUrlParagraph({ text: "https://example.com/", linkHref: null })).toBe("preview");
  });
  it("autolinked URL (mark href === text) is a preview", () => {
    expect(
      classifyUrlParagraph({ text: "https://example.com/", linkHref: "https://example.com/" }),
    ).toBe("preview");
  });
  it("labeled link (text !== href) is a link", () => {
    expect(classifyUrlParagraph({ text: "github.com", linkHref: "https://github.com/" })).toBe("link");
  });
  it("non-URL text is none", () => {
    expect(classifyUrlParagraph({ text: "hello world", linkHref: null })).toBe("none");
  });
});
