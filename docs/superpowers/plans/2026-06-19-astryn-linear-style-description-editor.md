# Linear-Style Description Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the drawer’s textarea/preview description UI with a Linear-style inline Tiptap editor that reads and writes Markdown and autosaves safely.

**Architecture:** A focused `DescriptionEditor` owns Tiptap, Markdown conversion, formatting UI, and a small serialized autosave queue. `IssueDrawer` supplies canonical Markdown and an awaitable mutation callback; only serialized Markdown crosses into TanStack Query, Rust, SQLite, and Linear. Selection and slash menus are local UI over a shared command catalog.

**Tech Stack:** React 19, TypeScript strict mode, Tiptap 3, official `@tiptap/markdown` GFM bridge, TanStack Query 5, Tailwind 4, Vitest, Testing Library, jsdom.

---

## File Map

- Create `src/features/drawer/descriptionAutosave.ts`: serialized, coalescing Markdown save queue.
- Create `src/features/drawer/descriptionAutosave.test.ts`: fake-timer queue tests.
- Create `src/features/drawer/descriptionExtensions.ts`: one canonical Tiptap extension set and Markdown conversion helpers.
- Create `src/features/drawer/descriptionExtensions.test.ts`: Markdown round-trip tests.
- Create `src/features/drawer/descriptionCommands.ts`: typed toolbar/slash command catalog.
- Create `src/features/drawer/DescriptionEditor.tsx`: editor lifecycle, menus, autosave status, external-content reconciliation.
- Create `src/features/drawer/DescriptionEditor.test.tsx`: editor interaction tests.
- Modify `src/features/drawer/IssueDrawer.tsx`: replace description edit/preview state with `DescriptionEditor`.
- Modify `src/styles/index.css`: editor, ProseMirror, toolbar, and slash-menu states.
- Modify `package.json`, `package-lock.json`, and `vitest.config.ts`: dependencies and TSX test discovery.

### Task 1: Install Tiptap and Component-Test Infrastructure

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Install runtime dependencies**

Run:

```bash
npm install @tiptap/core@^3 @tiptap/pm@^3 @tiptap/react@^3 @tiptap/starter-kit@^3 @tiptap/markdown@^3 @tiptap/extension-task-list@^3 @tiptap/extension-task-item@^3 @tiptap/extension-table@^3 @tiptap/extension-table-row@^3 @tiptap/extension-table-header@^3 @tiptap/extension-table-cell@^3
```

Expected: `package.json` and lockfile contain one compatible Tiptap 3 dependency family.

- [ ] **Step 2: Install test dependencies**

Run:

```bash
npm install --save-dev @testing-library/react @testing-library/user-event jsdom
```

Expected: Testing Library and jsdom appear under `devDependencies`.

- [ ] **Step 3: Enable TSX tests**

Change `vitest.config.ts` to:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
```

- [ ] **Step 4: Verify the existing suite remains green**

Run: `npx vitest run`

Expected: all existing tests pass before editor code is introduced.

- [ ] **Step 5: Commit dependency setup**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "build: add Tiptap editor dependencies"
```

### Task 2: Build and Test the Markdown Boundary

**Files:**
- Create: `src/features/drawer/descriptionExtensions.test.ts`
- Create: `src/features/drawer/descriptionExtensions.ts`

- [ ] **Step 1: Write failing Markdown round-trip tests**

Create `descriptionExtensions.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/drawer/descriptionExtensions.test.ts`

Expected: FAIL because `descriptionExtensions.ts` does not exist.

- [ ] **Step 3: Implement the canonical extension set**

Create `descriptionExtensions.ts`:

```ts
import type { Editor, Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";

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

export function markdownFromEditor(editor: Editor): string {
  const markdown = editor.getMarkdown().trim();
  return editor.isEmpty ? "" : markdown;
}
```

- [ ] **Step 4: Run Markdown tests and type checking**

Run: `npx vitest run src/features/drawer/descriptionExtensions.test.ts`

Expected: 3 tests pass with the default extension exports shown above.

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 5: Commit the Markdown boundary**

```bash
git add src/features/drawer/descriptionExtensions.ts src/features/drawer/descriptionExtensions.test.ts
git commit -m "feat: add Markdown-backed Tiptap schema"
```

### Task 3: Implement Serialized Autosave with Coalescing

**Files:**
- Create: `src/features/drawer/descriptionAutosave.test.ts`
- Create: `src/features/drawer/descriptionAutosave.ts`

- [ ] **Step 1: Write failing queue tests**

Create `descriptionAutosave.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { DescriptionAutosave } from "./descriptionAutosave";

afterEach(() => vi.useRealTimers());

describe("DescriptionAutosave", () => {
  it("debounces and saves the newest draft", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const queue = new DescriptionAutosave("old", save, 750);
    queue.update("a");
    queue.update("ab");
    await vi.advanceTimersByTimeAsync(749);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledWith("ab");
  });

  it("coalesces edits made during an in-flight save", async () => {
    let finish!: () => void;
    const first = new Promise<void>((resolve) => { finish = resolve; });
    const save = vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);
    const queue = new DescriptionAutosave("old", save, 0);
    queue.update("one");
    const pending = queue.flush();
    queue.update("three");
    finish();
    await pending;
    await queue.settled();
    expect(save.mock.calls).toEqual([["one"], ["three"]]);
  });

  it("keeps a failed draft and retries only after another edit", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const queue = new DescriptionAutosave("old", save, 0);
    queue.update("draft");
    await expect(queue.flush()).rejects.toThrow("offline");
    expect(queue.status).toBe("error");
    expect(queue.acceptExternal("old server value")).toBe(false);
    queue.update("draft again");
    await queue.flush();
    expect(save).toHaveBeenLastCalledWith("draft again");
  });

  it("accepts external content only when no local draft is pending", async () => {
    const queue = new DescriptionAutosave("one", vi.fn().mockResolvedValue(undefined), 750);
    expect(queue.acceptExternal("two")).toBe(true);
    queue.update("local");
    expect(queue.acceptExternal("three")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/drawer/descriptionAutosave.test.ts`

Expected: FAIL because `DescriptionAutosave` is missing.

- [ ] **Step 3: Implement the queue**

Create `descriptionAutosave.ts`:

```ts
export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export class DescriptionAutosave {
  status: SaveStatus = "idle";
  private draft: string;
  private acknowledged: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private failed = false;
  private listeners = new Set<(status: SaveStatus) => void>();

  constructor(
    initial: string,
    private readonly save: (markdown: string) => Promise<void>,
    private readonly delay = 750,
  ) {
    this.draft = initial;
    this.acknowledged = initial;
  }

  subscribe(listener: (status: SaveStatus) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private setStatus(status: SaveStatus) {
    this.status = status;
    this.listeners.forEach((listener) => listener(status));
  }

  update(markdown: string): void {
    this.draft = markdown;
    this.failed = false;
    this.setStatus(markdown === this.acknowledged ? "saved" : "dirty");
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => undefined);
    }, this.delay);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight) return this.inFlight;
    if (this.failed || this.draft === this.acknowledged) return;
    const saving = this.draft;
    this.setStatus("saving");
    this.inFlight = this.save(saving)
      .then(() => {
        this.acknowledged = saving;
        this.setStatus(this.draft === saving ? "saved" : "dirty");
      })
      .catch((error: unknown) => {
        this.failed = true;
        this.setStatus("error");
        throw error;
      })
      .finally(() => { this.inFlight = null; });
    try {
      await this.inFlight;
    } finally {
      if (!this.failed && this.draft !== this.acknowledged) await this.flush();
    }
  }

  async settled() {
    while (this.inFlight) await this.inFlight;
  }

  acceptExternal(markdown: string): boolean {
    if (this.inFlight || this.timer || this.failed || this.draft !== this.acknowledged) return false;
    this.draft = markdown;
    this.acknowledged = markdown;
    this.setStatus("idle");
    return true;
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}
```

- [ ] **Step 4: Run the queue tests**

Run: `npx vitest run src/features/drawer/descriptionAutosave.test.ts`

Expected: 4 tests pass with no unhandled promise rejection.

- [ ] **Step 5: Commit autosave**

```bash
git add src/features/drawer/descriptionAutosave.ts src/features/drawer/descriptionAutosave.test.ts
git commit -m "feat: add serialized description autosave"
```

### Task 4: Build Linear-Style Commands and Editor UI

**Files:**
- Create: `src/features/drawer/descriptionCommands.ts`
- Create: `src/features/drawer/DescriptionEditor.test.tsx`
- Create: `src/features/drawer/DescriptionEditor.tsx`
- Modify: `src/styles/index.css`

- [ ] **Step 1: Create the typed command catalog**

Create `descriptionCommands.ts`:

```ts
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
```

- [ ] **Step 2: Write failing editor interaction tests**

Create `DescriptionEditor.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DescriptionEditor } from "./DescriptionEditor";

afterEach(() => vi.useRealTimers());

describe("DescriptionEditor", () => {
  it("renders Markdown as inline rich text", async () => {
    render(<DescriptionEditor markdown="## Plan\n\n**Ship it**" editable onSave={vi.fn()} />);
    expect(await screen.findByRole("heading", { level: 2, name: "Plan" })).toBeTruthy();
    expect(screen.getByText("Ship it").tagName).toBe("STRONG");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("opens the slash menu and applies a heading", async () => {
    const user = userEvent.setup();
    render(<DescriptionEditor markdown="" editable onSave={vi.fn()} />);
    const editor = screen.getByRole("textbox", { name: "Issue description" });
    await user.click(editor);
    await user.keyboard("/hea");
    expect(screen.getByRole("option", { name: "Heading 1" })).toBeTruthy();
    await user.keyboard("{Enter}");
    expect(editor.querySelector("h1")).toBeTruthy();
  });

  it("opens the selection toolbar for selected text", async () => {
    const user = userEvent.setup();
    render(<DescriptionEditor markdown="Select **this text**" editable onSave={vi.fn()} />);
    const strong = await screen.findByText("this text");
    const range = document.createRange();
    range.selectNodeContents(strong);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.mouseUp(strong);
    expect(await screen.findByRole("toolbar", { name: "Text formatting" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Link" }));
    expect(screen.getByRole("textbox", { name: "Link URL" })).toBeTruthy();
  });

  it("debounces Markdown autosave and shows saved state", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DescriptionEditor markdown="Start" editable onSave={save} />);
    const editor = screen.getByRole("textbox", { name: "Issue description" });
    await user.click(editor);
    await user.keyboard(" more");
    expect(screen.getByText("Saving soon…")).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(750));
    expect(save).toHaveBeenCalledWith(expect.stringContaining("Start more"));
    expect(await screen.findByText("Saved")).toBeTruthy();
  });

  it("is read-only for cached drawer data", async () => {
    render(<DescriptionEditor markdown="Cached" editable={false} onSave={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Issue description" }).getAttribute("contenteditable")).toBe("false");
  });
});
```

- [ ] **Step 3: Run the component tests to verify they fail**

Run: `npx vitest run src/features/drawer/DescriptionEditor.test.tsx`

Expected: FAIL because `DescriptionEditor.tsx` does not exist.

- [ ] **Step 4: Implement `DescriptionEditor`**

Create `DescriptionEditor.tsx` with these concrete responsibilities:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Link2 } from "lucide-react";
import { DescriptionAutosave, type SaveStatus } from "./descriptionAutosave";
import { descriptionExtensions, markdownFromEditor } from "./descriptionExtensions";
import { inlineCommands, slashCommands } from "./descriptionCommands";

type SlashState = { from: number; query: string; selected: number; left: number; top: number };

export function DescriptionEditor({
  markdown,
  editable,
  onSave,
}: {
  markdown: string;
  editable: boolean;
  onSave: (markdown: string) => Promise<void>;
}) {
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const editorRef = useRef<Editor | null>(null);
  const queue = useMemo(
    () => new DescriptionAutosave(markdown, (value) => saveRef.current(value), 750),
    // One queue per issue/editor mount; external Markdown is reconciled below.
    [],
  );
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const slashRef = useRef<SlashState | null>(null);
  slashRef.current = slash;

  const editor = useEditor({
    extensions: descriptionExtensions(),
    content: markdown,
    contentType: "markdown",
    editable,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Issue description",
        class: "astryn-description-editor",
      },
      handleKeyDown: (_view, event) => {
        const current = slashRef.current;
        const currentEditor = editorRef.current;
        if (!current || !currentEditor) return false;
        const choices = slashCommands.filter((item) =>
          `${item.label} ${item.keywords}`.toLowerCase().includes(current.query.toLowerCase()),
        );
        if (event.key === "Escape") { setSlash(null); return true; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const delta = event.key === "ArrowDown" ? 1 : -1;
          setSlash({ ...current, selected: (current.selected + delta + choices.length) % choices.length });
          return true;
        }
        if (event.key === "Enter" && choices.length) {
          event.preventDefault();
          currentEditor.chain().focus().deleteRange({ from: current.from, to: currentEditor.state.selection.from }).run();
          choices[current.selected]?.run(currentEditor);
          setSlash(null);
          return true;
        }
        return false;
      },
      handleBlur: () => { void queue.flush().catch(() => undefined); return false; },
    },
    onUpdate: ({ editor: current }) => {
      const value = markdownFromEditor(current);
      queue.update(value);
      const { $from } = current.state.selection;
      const before = $from.parent.textBetween(0, $from.parentOffset, "\n", "\0");
      const match = before.match(/(?:^|\s)\/([a-z0-9]*)$/i);
      if (match) {
        const coords = current.view.coordsAtPos(current.state.selection.from);
        const root = current.view.dom.parentElement?.getBoundingClientRect();
        setSlash({
          from: current.state.selection.from - match[1].length - 1,
          query: match[1],
          selected: 0,
          left: coords.left - (root?.left ?? 0),
          top: coords.bottom - (root?.top ?? 0) + 6,
        });
      } else setSlash(null);
    },
  });

  editorRef.current = editor;
  useEffect(() => queue.subscribe(setStatus), [queue]);
  useEffect(() => { editor?.setEditable(editable); }, [editable, editor]);
  useEffect(() => {
    if (editor && queue.acceptExternal(markdown) && markdownFromEditor(editor) !== markdown) {
      editor.commands.setContent(markdown, { contentType: "markdown", emitUpdate: false });
    }
  }, [editor, markdown, queue]);
  useEffect(() => () => {
    void queue.flush().catch(() => undefined);
    queue.destroy();
  }, [queue]);

  const choices = slash
    ? slashCommands.filter((item) => `${item.label} ${item.keywords}`.toLowerCase().includes(slash.query.toLowerCase()))
    : [];

  const applyLink = () => {
    if (!editor) return;
    const href = linkValue.trim();
    if (href) editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    else editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkMode(false);
  };

  return (
    <div className="relative">
      {editor && editable && (
        <BubbleMenu editor={editor} options={{ placement: "top" }}>
          <div className="description-bubble-menu" role="toolbar" aria-label="Text formatting">
            {linkMode ? (
              <form onSubmit={(event) => { event.preventDefault(); applyLink(); }}>
                <input
                  autoFocus
                  aria-label="Link URL"
                  value={linkValue}
                  onChange={(event) => setLinkValue(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Escape") setLinkMode(false); }}
                  placeholder="Paste a link…"
                />
              </form>
            ) : (
              <>
                {inlineCommands.map(({ id, label, icon: Icon, active, run }) => (
                  <button key={id} type="button" aria-label={label} aria-pressed={editor.isActive(active)} onClick={() => run(editor)}>
                    <Icon className="size-3.5" />
                  </button>
                ))}
                <button
                  type="button"
                  aria-label="Link"
                  aria-pressed={editor.isActive("link")}
                  onClick={() => {
                    setLinkValue(editor.getAttributes("link").href ?? "");
                    setLinkMode(true);
                  }}
                >
                  <Link2 className="size-3.5" />
                </button>
              </>
            )}
          </div>
        </BubbleMenu>
      )}
      <EditorContent editor={editor} />
      {slash && choices.length > 0 && (
        <div
          className="description-slash-menu"
          role="listbox"
          aria-label="Formatting commands"
          style={{ left: slash.left, top: slash.top }}
        >
          {choices.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-label={item.label}
              aria-selected={index === slash.selected}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                editor?.chain().focus().deleteRange({ from: slash.from, to: editor.state.selection.from }).run();
                if (editor) item.run(editor);
                setSlash(null);
              }}
            >
              <item.icon className="size-4" /><span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
      {editable && status !== "idle" && (
        <span className={`description-save-status description-save-status--${status}`} aria-live="polite">
          {status === "dirty" ? "Saving soon…" : status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Couldn’t save"}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Add scoped editor styling**

Append to `src/styles/index.css`:

```css
.astryn-description-editor {
  min-height: 8rem;
  border-radius: 0.5rem;
  padding: 0.5rem 0;
  color: var(--foreground);
  font-size: 0.875rem;
  line-height: 1.65;
  outline: none;
}
.astryn-description-editor[contenteditable="true"]:focus {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ring) 55%, transparent);
  padding-inline: 0.75rem;
}
.astryn-description-editor p.is-editor-empty:first-child::before {
  content: "Add description…";
  float: left;
  height: 0;
  color: var(--muted-foreground);
  pointer-events: none;
}
.astryn-description-editor h1 { margin: 1.25rem 0 0.5rem; font-size: 1.5rem; font-weight: 650; }
.astryn-description-editor h2 { margin: 1rem 0 0.4rem; font-size: 1.25rem; font-weight: 650; }
.astryn-description-editor h3 { margin: 0.875rem 0 0.35rem; font-size: 1.05rem; font-weight: 650; }
.astryn-description-editor ul { list-style: disc; padding-left: 1.4rem; }
.astryn-description-editor ol { list-style: decimal; padding-left: 1.4rem; }
.astryn-description-editor ul[data-type="taskList"] { list-style: none; padding-left: 0; }
.astryn-description-editor li[data-type="taskItem"] { display: flex; align-items: flex-start; gap: 0.5rem; }
.astryn-description-editor li[data-type="taskItem"] > label { margin-top: 0.2rem; }
.astryn-description-editor blockquote { border-left: 2px solid var(--border); padding-left: 0.875rem; color: var(--muted-foreground); }
.astryn-description-editor pre { overflow-x: auto; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--card); padding: 0.75rem; }
.astryn-description-editor code:not(pre code) { border-radius: 0.25rem; background: var(--secondary); padding: 0.1rem 0.3rem; }
.astryn-description-editor table { width: 100%; border-collapse: collapse; }
.astryn-description-editor th, .astryn-description-editor td { border: 1px solid var(--border); padding: 0.4rem 0.55rem; text-align: left; }
.description-bubble-menu, .description-slash-menu { border: 1px solid var(--border); background: var(--popover); box-shadow: 0 12px 36px rgb(0 0 0 / 35%); }
.description-bubble-menu { display: flex; gap: 0.125rem; border-radius: 0.5rem; padding: 0.25rem; }
.description-bubble-menu button { border-radius: 0.3rem; padding: 0.35rem; color: var(--muted-foreground); }
.description-bubble-menu button:hover, .description-bubble-menu button[aria-pressed="true"] { background: var(--accent); color: var(--foreground); }
.description-bubble-menu input { width: 14rem; border-radius: 0.3rem; background: transparent; padding: 0.3rem 0.45rem; color: var(--foreground); outline: none; }
.description-slash-menu { position: absolute; z-index: 70; width: 15rem; border-radius: 0.6rem; padding: 0.3rem; }
.description-slash-menu button { display: flex; width: 100%; align-items: center; gap: 0.6rem; border-radius: 0.4rem; padding: 0.5rem 0.6rem; color: var(--foreground); }
.description-slash-menu button[aria-selected="true"], .description-slash-menu button:hover { background: var(--accent); }
.description-save-status { position: absolute; right: 0; top: -1.25rem; font-size: 0.6875rem; color: var(--muted-foreground); }
.description-save-status--error { color: #f87171; }
```

- [ ] **Step 6: Run component tests and static checks**

Run: `npx vitest run src/features/drawer/DescriptionEditor.test.tsx`

Expected: 5 tests pass.

Run: `npx tsc --noEmit`

Expected: clean with no unused imports, stale closure errors, or unsupported Tiptap command types.

- [ ] **Step 7: Commit editor UI**

```bash
git add src/features/drawer/descriptionCommands.ts src/features/drawer/DescriptionEditor.tsx src/features/drawer/DescriptionEditor.test.tsx src/styles/index.css
git commit -m "feat: add Linear-style description editor"
```

### Task 5: Integrate the Editor into the Issue Drawer

**Files:**
- Modify: `src/features/drawer/IssueDrawer.tsx`

- [ ] **Step 1: Add an integration assertion before changing the drawer**

Extend `DescriptionEditor.test.tsx` with:

```tsx
it("sends empty Markdown to the save boundary for null normalization", async () => {
  vi.useFakeTimers();
  const save = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<DescriptionEditor markdown="Remove me" editable onSave={save} />);
  const editor = screen.getByRole("textbox", { name: "Issue description" });
  await user.click(editor);
  await user.keyboard("{Meta>}a{/Meta}{Backspace}");
  await act(() => vi.advanceTimersByTimeAsync(750));
  expect(save).toHaveBeenCalledWith("");
});
```

- [ ] **Step 2: Run the focused test**

Run: `npx vitest run src/features/drawer/DescriptionEditor.test.tsx`

Expected: PASS before drawer wiring, proving the component emits the value the boundary must normalize.

- [ ] **Step 3: Replace description state and preview UI**

In `IssueDrawer.tsx`:

1. Keep `ReactMarkdown` and `remarkGfm` for read-only activity comments.
2. Import `DescriptionEditor`.
3. Remove `desc`, `editingDesc`, the description synchronization effect, the Edit/Done control, description textarea, and description `ReactMarkdown` preview.
4. Add an awaitable save callback next to `patch`:

```tsx
const saveDescription = async (markdown: string) => {
  await update.mutateAsync({
    id,
    patch: { description: markdown === "" ? null : markdown },
  });
};
```

5. Render the editor in the existing description section:

```tsx
<section className="mt-6">
  <DescriptionEditor
    key={id}
    markdown={detailDesc}
    editable={editable}
    onSave={saveDescription}
  />
</section>
```

Do not add localStorage, HTML persistence, a source toggle, or a second mutation path.

- [ ] **Step 4: Run frontend tests and build**

Run: `npx vitest run`

Expected: all existing and new tests pass.

Run: `npx tsc --noEmit`

Expected: clean.

Run: `npm run build`

Expected: Vite production build passes; record but do not treat the existing chunk-size warning as a failure.

- [ ] **Step 5: Commit drawer integration**

```bash
git add src/features/drawer/IssueDrawer.tsx src/features/drawer/DescriptionEditor.test.tsx
git commit -m "feat: edit issue descriptions inline"
```

### Task 6: Full Verification and Tauri Manual Check

**Files:**
- Modify only if a verification failure identifies a concrete defect.

- [ ] **Step 1: Run all automated gates**

Run each command independently:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
npx tsc --noEmit
npx vitest run
npm run build
```

Expected: every command exits zero. Do not run `npm run tauri build`; no `.app` or `.dmg` is required.

- [ ] **Step 2: Run the desktop app without bundling**

Run: `npm run tauri dev`

Verify in a live issue drawer:

1. Existing Markdown opens as rich text without an Edit button.
2. Typing Markdown and pasting GFM produces rich formatting.
3. Selection toolbar formatting works with mouse and keyboard focus.
4. `/` menu filters, navigates with arrows, selects with Enter, and closes with Escape.
5. Description saves after 750 ms and survives closing/reopening the drawer.
6. Closing immediately after typing flushes the latest Markdown.
7. A simulated network failure retains the local draft and displays sanitized failure feedback.
8. Cached/offline drawer content is read-only.
9. Links still open only through the validated system-browser path.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only intended editor-related changes plus the previously reviewed uncommitted M1 fixes.

- [ ] **Step 4: Commit any verification-only correction**

If Step 1 or 2 required a correction, interactively stage only the corrected hunks:

```bash
git add -p
git diff --cached --check
git commit -m "fix: harden description editor behavior"
```

If no correction was required, do not create an empty commit.
