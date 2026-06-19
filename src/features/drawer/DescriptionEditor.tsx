import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Link2 } from "lucide-react";
import { DescriptionAutosave, type SaveStatus } from "./descriptionAutosave";
import { descriptionExtensions, markdownFromEditor } from "./descriptionExtensions";
import { filterSlashCommands, inlineCommands } from "./descriptionCommands";

type SlashState = { from: number; query: string; selected: number; left: number; top: number };

export function DescriptionEditor({
  markdown,
  editable,
  onSave,
  onOpenLink,
}: {
  markdown: string;
  editable: boolean;
  onSave: (markdown: string) => Promise<void>;
  onOpenLink: (href: string) => void;
}) {
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const linkRef = useRef(onOpenLink);
  linkRef.current = onOpenLink;
  const editorRef = useRef<Editor | null>(null);
  const queue = useMemo(
    () => new DescriptionAutosave(markdown, (value) => saveRef.current(value), 750),
    // One queue per issue/editor mount; external Markdown is reconciled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        const choices = filterSlashCommands(current.query);
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
      // Intercept link clicks (editable AND read-only) so the webview never
      // navigates. The drawer resolves in-app issue links vs. validated
      // external links via onOpenLink.
      handleClickOn: (_view, _pos, _node, _nodePos, event) => {
        const anchor = (event.target as HTMLElement | null)?.closest("a");
        const href = anchor?.getAttribute("href");
        if (href) {
          event.preventDefault();
          linkRef.current(href);
          return true;
        }
        return false;
      },
    },
    // onBlur is the correct Tiptap hook; editorProps.handleBlur does not exist
    // in ProseMirror's EditorProps type.
    onBlur: () => { void queue.flush().catch(() => undefined); },
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
  // Seed the autosave baseline from the SERIALIZED form and adopt server
  // content only when the local editor is clean. Baselining on the serialized
  // form keeps normalization-only differences from looking like a draft and
  // prevents post-save churn.
  useEffect(() => {
    if (!editor) return;
    if (!queue.acceptExternal(markdownFromEditor(editor))) return; // dirty -> keep draft
    if (markdownFromEditor(editor) !== markdown) {
      editor.commands.setContent(markdown, { contentType: "markdown", emitUpdate: false });
      queue.acceptExternal(markdownFromEditor(editor)); // re-baseline on adopted content
    }
  }, [editor, markdown, queue]);
  useEffect(() => () => {
    void queue.flush().catch(() => undefined);
    queue.destroy();
  }, [queue]);

  const choices = slash ? filterSlashCommands(slash.query) : [];

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
          {status === "dirty" ? "Saving soon…" : status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Couldn't save"}
        </span>
      )}
    </div>
  );
}
