// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor, rootCtx, serializerCtx } from "@milkdown/kit/core";
import { schemaCtx } from "@milkdown/core";
import { DOMParser as ProseMirrorDOMParser } from "@milkdown/kit/prose/model";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { applyDescriptionConfig, roundtripMarkdown } from "./milkdownEditor";

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
      expect(second.valid).toBe(true);
      expect(second.markdown).toBe(first.markdown);
    });
  }
});

describe("Loose list preservation", () => {
  it("loose ordered list: schema-valid and retains blank line between items", async () => {
    const md = "1. one\n\n2. two";
    const first = await roundtripMarkdown(md);
    expect(first.error ?? "ok").toBe("ok");
    expect(first.valid).toBe(true);
    // The serialized output must contain a blank line — loose list must stay loose
    expect(first.markdown).toContain("\n\n");
    const second = await roundtripMarkdown(first.markdown);
    expect(second.valid).toBe(true);
    expect(second.markdown).toBe(first.markdown);
  });

  it("loose bullet list: schema-valid and retains blank line between items", async () => {
    const md = "- one\n\n- two";
    const first = await roundtripMarkdown(md);
    expect(first.error ?? "ok").toBe("ok");
    expect(first.valid).toBe(true);
    // The serialized output must contain a blank line — loose list must stay loose
    expect(first.markdown).toContain("\n\n");
    const second = await roundtripMarkdown(first.markdown);
    expect(second.valid).toBe(true);
    expect(second.markdown).toBe(first.markdown);
  });
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

/**
 * Regression test for DOM-parsed (paste) spread="false" corruption.
 *
 * When a tight ordered list is copy-pasted, ProseMirror parses it from HTML
 * via the schema's parseDOM rules. The native orderedListSchema.parseDOM
 * returned `{ spread: dom.dataset.spread }` (a raw string "false") instead of
 * a boolean, which caused:
 *   1. doc.check() to throw (schema validate:"boolean" rejects strings)
 *   2. `=== "true"` check in the toMarkdown runner always yielded false →
 *      tight list serialized as loose (blank lines injected — data corruption)
 *
 * This test builds a ProseMirror doc by parsing HTML directly through the
 * patched schema's DOMParser rules (the same path a paste event uses), then
 * verifies:
 *   - doc.check() passes (spread is stored as boolean, not string)
 *   - serialized Markdown has NO blank line between items (stays tight)
 */
describe("DOM-paste spread regression", () => {
  /**
   * Spin up a headless Milkdown editor to get the fully-patched ProseMirror
   * schema, then use ProseMirror's DOMParser to parse the given HTML string
   * through that schema's parseDOM rules (the same path a paste event uses).
   * Returns validity + serialized markdown so assertions can be made.
   */
  async function parseFromHTML(
    html: string,
  ): Promise<{ valid: boolean; error?: string; markdown: string }> {
    // Build a minimal headless editor just to obtain the patched schema.
    const root = document.createElement("div");
    const editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        applyDescriptionConfig(ctx);
      })
      .use(commonmark)
      .use(gfm)
      .create();

    let out = "";
    let valid = false;
    let error: string | undefined;

    editor.action((ctx) => {
      const schema = ctx.get(schemaCtx);
      const serializer = ctx.get(serializerCtx);

      // Parse the HTML through ProseMirror's DOMParser using the patched schema.
      // This exercises exactly the same parseDOM rules as a paste event.
      const container = document.createElement("div");
      // Safe: html is a hardcoded test fixture, not user-controlled input.
      // eslint-disable-next-line no-unsanitized/property
      container.innerHTML = html;
      const doc = ProseMirrorDOMParser.fromSchema(schema).parse(container);

      try {
        doc.check();
        valid = true;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      out = serializer(doc);
    });

    await editor.destroy();
    return { valid, error, markdown: out.trimEnd() };
  }

  it("tight <ol> pasted via DOM: doc.check() passes and serializes as tight (no blank line)", async () => {
    // HTML that a browser produces for a tight ordered list copy-paste.
    // data-spread="false" is what Milkdown's toDOM writes for tight lists.
    const html = [
      `<ol data-spread="false">`,
      `<li data-spread="false"><p>one</p></li>`,
      `<li data-spread="false"><p>two</p></li>`,
      `</ol>`,
    ].join("");
    const result = await parseFromHTML(html);
    // doc.check() must not throw — spread must be stored as boolean, not string.
    expect(result.error ?? "ok").toBe("ok");
    expect(result.valid).toBe(true);
    // Must NOT contain a blank line between items — tight list must stay tight.
    expect(result.markdown).not.toMatch(/\n\n/);
    // Must contain both items.
    expect(result.markdown).toContain("one");
    expect(result.markdown).toContain("two");
  });
});
