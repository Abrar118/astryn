import type { Editor, Extensions, JSONContent, MarkdownParseResult } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { Image } from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { DescriptionImage } from "./DescriptionImage";

/** Image extension wired for Markdown round-trip + React NodeView proxy rendering. */
const LinearImage = Image.configure({ inline: false }).extend({
  /** Token type emitted by marked for `![alt](url)` syntax. */
  markdownTokenName: "image",

  /**
   * Parse a marked `image` token `{ href, text, title }` into an `image` node.
   * `href` is stored as-is on `src` — never the proxied data URL.
   * Returns null (skip) when `href` is missing so a malformed token doesn't
   * produce an empty `![]()` in the document.
   */
  parseMarkdown(token: { href?: string; text?: string; title?: string | null }): MarkdownParseResult {
    // The @tiptap/markdown runtime treats a falsy result as "skip this token"
    // (normalizeParseResult returns false → parseFallbackToken is called).
    // The declared MarkdownParseResult type doesn't include null, so cast to satisfy tsc.
    if (!token.href) return null as unknown as MarkdownParseResult;
    return {
      type: "image",
      attrs: {
        src: token.href,
        alt: token.text ?? null,
        title: token.title ?? null,
      },
    };
  },

  /**
   * Serialize the `image` node back to `![alt](src)` markdown.
   * Reads `node.attrs.src` — the ORIGINAL URL, never a proxied data URL.
   *
   * Escaping:
   * - `]` in alt is backslash-escaped so it cannot close the alt bracket early.
   * - src containing `(`, `)`, or whitespace is wrapped in `<…>` (CommonMark
   *   angle-bracket destination), preserving the URL byte-for-byte on round-trip.
   * - `"` in title is backslash-escaped.
   */
  renderMarkdown(node: JSONContent) {
    const attrs = (node.attrs ?? {}) as { src?: string; alt?: string | null; title?: string | null };
    const safeAlt = (attrs.alt ?? "").replace(/\]/g, "\\]");
    const rawSrc = attrs.src ?? "";
    const safeSrc = /[()\s]/.test(rawSrc) ? `<${rawSrc}>` : rawSrc;
    const title = attrs.title ? ` "${attrs.title.replace(/"/g, '\\"')}"` : "";
    return `![${safeAlt}](${safeSrc}${title})`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(DescriptionImage);
  },
});

export function descriptionExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: { HTMLAttributes: { spellcheck: "false" } },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener noreferrer" },
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    LinearImage,
    Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
  ];
}

/** Strip padded whitespace from GFM table cells so serialization is stable. */
function normalizeTablePadding(markdown: string): string {
  let inFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      // Track fenced code block boundaries (``` or ~~~, three or more)
      if (/^(`{3,}|~{3,})/.test(line.trim())) {
        inFence = !inFence;
        return line;
      }
      // Pass through lines inside fenced code blocks verbatim
      if (inFence) return line;
      // Match GFM table rows: starts and ends with |
      if (/^\|.*\|$/.test(line.trim())) {
        return line
          // Split on unescaped pipes only to preserve \| inside cell text
          .split(/(?<!\\)\|/)
          .map((cell, i, arr) => {
            // keep the empty first/last segments that result from leading/trailing |
            if (i === 0 || i === arr.length - 1) return cell;
            const trimmed = cell.trim();
            // preserve separator rows like | --- | --- |
            return trimmed ? ` ${trimmed} ` : cell;
          })
          .join("|");
      }
      return line;
    })
    .join("\n");
}

export function markdownFromEditor(editor: Editor): string {
  if (editor.isEmpty) return "";
  return normalizeTablePadding(editor.getMarkdown()).trim();
}
