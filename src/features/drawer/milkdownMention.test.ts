// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { issueMentionFromUrl } from "./milkdownMention";
import { roundtripMarkdown } from "./milkdownEditor";

describe("issueMentionFromUrl", () => {
  it("extracts the identifier from a Linear issue URL", () => {
    expect(
      issueMentionFromUrl("https://linear.app/gam/issue/PRO-153/x"),
    ).toBe("PRO-153");
  });
  it("returns null for non-issue links", () => {
    expect(issueMentionFromUrl("https://example.com")).toBeNull();
  });
  it("extracts uppercase identifier regardless of input case", () => {
    expect(
      issueMentionFromUrl("https://linear.app/gam/issue/pro-42/some-title"),
    ).toBe("PRO-42");
  });
  it("returns null for a Linear URL without /issue/ segment", () => {
    expect(issueMentionFromUrl("https://linear.app/gam/team/PRO")).toBeNull();
  });
});

describe("mention round-trip", () => {
  it("a mention link survives serialization as the original markdown link", async () => {
    const md = "done ([PRO-153](https://linear.app/gam/issue/PRO-153/x))";
    const r = await roundtripMarkdown(md);
    expect(r.valid).toBe(true);
    expect(r.markdown).toContain(
      "[PRO-153](https://linear.app/gam/issue/PRO-153/x)",
    );
  });
});
