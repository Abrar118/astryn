// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { roundtripMarkdown } from "./milkdownEditor";

const corpus: Record<string, string> = {
  imageBrackets: "![a[b]c](https://uploads.linear.app/x.png)",
  codeFence: "````\n```\ninner\n```\n````",
  tablePipe: "| A\\|B | C |\n| --- | --- |\n| 1 | 2 |",
  linkCode: "see [`provision-clerk --create`](https://linear.app/x/issue/PRO-1/s)",
  strikeCode: "~~`old`~~ done",
  imageInList: "- ![p](https://uploads.linear.app/x.png)\n- two",
  standaloneImage: "![p](https://uploads.linear.app/x.png)",
  taskList: "- [ ] todo\n- [x] done",
  headingsAndCode: "## Plan\n\n**Bold** and *italic* with `code`.\n\n```ts\nconst x = 1\n```",
};

describe("Milkdown markdown round-trip", () => {
  for (const [name, md] of Object.entries(corpus)) {
    it(`${name}: schema-valid and idempotent`, async () => {
      const first = await roundtripMarkdown(md);
      expect(first.error ?? "ok").toBe("ok");
      expect(first.valid).toBe(true);
      const second = await roundtripMarkdown(first.markdown);
      expect(second.markdown).toBe(first.markdown);
    });
  }
});

describe("Milkdown image node", () => {
  it("keeps the original URL in markdown, never a data URL", async () => {
    const r = await roundtripMarkdown(
      "![diagram](https://uploads.linear.app/a/b.png)",
    );
    expect(r.valid).toBe(true);
    expect(r.markdown).toContain(
      "![diagram](https://uploads.linear.app/a/b.png)",
    );
    expect(r.markdown).not.toContain("data:");
  });
});
