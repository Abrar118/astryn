// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { descriptionExtensions, markdownFromEditor } from "./descriptionExtensions";

const editors: Editor[] = [];
function fromMarkdown(markdown: string) {
  const editor = new Editor({
    extensions: descriptionExtensions(),
    content: markdown,
    contentType: "markdown",
  });
  editors.push(editor);
  return editor;
}

afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

describe("description Markdown", () => {
  it("round-trips common issue formatting", () => {
    const editor = fromMarkdown(
      "## Plan\n\n**Bold** and *italic* with `code`.\n\n> Note\n\n- one\n- two\n\n```ts\nconst x = 1\n```",
    );
    const output = markdownFromEditor(editor);
    expect(output).toContain("## Plan");
    expect(output).toContain("**Bold**");
    expect(output).toContain("*italic*");
    expect(output).toContain("```ts");
  });

  it("round-trips GFM task lists and tables", () => {
    const editor = fromMarkdown(
      "- [ ] Todo\n- [x] Done\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
    );
    const output = markdownFromEditor(editor);
    expect(output).toContain("- [ ] Todo");
    expect(output).toContain("- [x] Done");
    expect(output).toContain("| A | B |");
  });

  it("serializes an empty document as an empty string", () => {
    expect(markdownFromEditor(fromMarkdown(""))).toBe("");
  });

  it("serializes idempotently so external reconciliation does not churn the editor", () => {
    const src = "## Plan\n\n- [ ] a\n- [x] b\n\n| A | B |\n| --- | --- |\n| 1 | 2 |";
    const once = markdownFromEditor(fromMarkdown(src));
    const twice = markdownFromEditor(fromMarkdown(once));
    expect(twice).toBe(once);
  });
});
