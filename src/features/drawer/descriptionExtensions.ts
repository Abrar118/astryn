import type { Editor, Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";

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
    Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
  ];
}

/** Strip padded whitespace from GFM table cells so serialization is stable. */
function normalizeTablePadding(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => {
      // Match GFM table rows: starts and ends with |
      if (/^\|.*\|$/.test(line.trim())) {
        return line
          .split("|")
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
  return normalizeTablePadding(editor.getMarkdown().trim());
}
