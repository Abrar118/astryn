import type { Editor } from "@tiptap/core";
import {
  Bold, Braces, CheckSquare, Code2, Heading1, Heading2, Heading3,
  Italic, List, ListOrdered, Minus, Pilcrow, Quote, Strikethrough, Table2,
  type LucideIcon,
} from "lucide-react";

export type DescriptionCommand = {
  id: string;
  label: string;
  keywords: string;
  icon: LucideIcon;
  run: (editor: Editor) => void;
};

export const slashCommands: DescriptionCommand[] = [
  { id: "text", label: "Text", keywords: "paragraph plain", icon: Pilcrow, run: (e) => { e.chain().focus().setParagraph().run(); } },
  { id: "h1", label: "Heading 1", keywords: "title h1", icon: Heading1, run: (e) => { e.chain().focus().toggleHeading({ level: 1 }).run(); } },
  { id: "h2", label: "Heading 2", keywords: "subtitle h2", icon: Heading2, run: (e) => { e.chain().focus().toggleHeading({ level: 2 }).run(); } },
  { id: "h3", label: "Heading 3", keywords: "subtitle h3", icon: Heading3, run: (e) => { e.chain().focus().toggleHeading({ level: 3 }).run(); } },
  { id: "bullet", label: "Bulleted list", keywords: "unordered bullet", icon: List, run: (e) => { e.chain().focus().toggleBulletList().run(); } },
  { id: "ordered", label: "Numbered list", keywords: "ordered number", icon: ListOrdered, run: (e) => { e.chain().focus().toggleOrderedList().run(); } },
  { id: "task", label: "Checklist", keywords: "task todo check", icon: CheckSquare, run: (e) => { e.chain().focus().toggleTaskList().run(); } },
  { id: "quote", label: "Quote", keywords: "blockquote", icon: Quote, run: (e) => { e.chain().focus().toggleBlockquote().run(); } },
  { id: "code", label: "Code block", keywords: "code fenced", icon: Code2, run: (e) => { e.chain().focus().toggleCodeBlock().run(); } },
  { id: "rule", label: "Divider", keywords: "rule separator", icon: Minus, run: (e) => { e.chain().focus().setHorizontalRule().run(); } },
  { id: "table", label: "Table", keywords: "grid", icon: Table2, run: (e) => { e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); } },
];

export const inlineCommands = [
  { id: "bold", label: "Bold", icon: Bold, active: "bold", run: (e: Editor) => e.chain().focus().toggleBold().run() },
  { id: "italic", label: "Italic", icon: Italic, active: "italic", run: (e: Editor) => e.chain().focus().toggleItalic().run() },
  { id: "strike", label: "Strikethrough", icon: Strikethrough, active: "strike", run: (e: Editor) => e.chain().focus().toggleStrike().run() },
  { id: "code", label: "Inline code", icon: Braces, active: "code", run: (e: Editor) => e.chain().focus().toggleCode().run() },
] as const;

/** Pure: slash-menu matches for a query, case-insensitive over label + keywords. */
export function filterSlashCommands(query: string): DescriptionCommand[] {
  const q = query.toLowerCase();
  return slashCommands.filter((c) => `${c.label} ${c.keywords}`.toLowerCase().includes(q));
}
