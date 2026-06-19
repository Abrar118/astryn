import type { Editor, Extensions, JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { Image } from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { DescriptionImage } from "./DescriptionImage";

/** Image extension wired for Markdown round-trip + React NodeView proxy rendering. */
const LinearImage = Image.configure({ inline: true }).extend({
  /** Token type emitted by marked for `![alt](url)` syntax. */
  markdownTokenName: "image",

  /**
   * Parse a marked `image` token `{ href, text, title }` into an `image` node.
   * `href` is stored as-is on `src` — never the proxied data URL.
   */
  parseMarkdown(token: { href?: string; text?: string; title?: string | null }) {
    return {
      type: "image",
      attrs: {
        src: token.href ?? "",
        alt: token.text ?? null,
        title: token.title ?? null,
      },
    };
  },

  /**
   * Serialize the `image` node back to `![alt](src)` markdown.
   * Reads `node.attrs.src` — the ORIGINAL URL, never a proxied data URL.
   */
  renderMarkdown(node: JSONContent) {
    const attrs = (node.attrs ?? {}) as { src?: string; alt?: string | null; title?: string | null };
    const src = attrs.src ?? "";
    const alt = attrs.alt ?? "";
    const title = attrs.title ? ` "${attrs.title}"` : "";
    return `![${alt}](${src}${title})`;
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
