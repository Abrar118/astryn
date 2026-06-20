import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MilkdownPlugin } from "@milkdown/ctx";
import { Editor } from "@milkdown/kit/core";
import {
  defaultValueCtx,
  rootCtx,
  editorViewOptionsCtx,
} from "@milkdown/kit/core";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { DescriptionAutosave, type SaveStatus } from "./descriptionAutosave";
import { descriptionPlugins, applyDescriptionConfig } from "./milkdownEditor";
import {
  configureDescriptionSlash,
  configureDescriptionTooltip,
} from "./milkdownMenus";
import { descriptionMentionPlugin } from "./milkdownMention";
import { createMarkdownComponents, type MentionResolver } from "./markdownComponents";

/**
 * Some Linear descriptions contain Markdown that ProseMirror rejects (e.g. a
 * code span that is also a link, an image as a bare list item, or duplicate
 * marks from malformed `**`). This boundary catches that so the drawer shows
 * the description read-only instead of crashing the whole app.
 */
export class EditorErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.warn("[astryn] description editor could not render; showing read-only view", error);
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

/** Read-only Markdown render used when the rich editor can't mount the content. */
export function ReadOnlyDescription({
  markdown,
  onOpenLink,
  resolveMention,
}: {
  markdown: string;
  onOpenLink: (href: string) => void;
  resolveMention?: MentionResolver;
}) {
  const components = useMemo(
    () =>
      createMarkdownComponents({
        onActivateLink: onOpenLink,
        resolveMention: resolveMention ?? (() => undefined),
      }),
    [onOpenLink, resolveMention],
  );
  return (
    <div className="astryn-prose prose prose-sm prose-invert max-w-none prose-headings:font-semibold prose-a:text-primary">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown || "_No description_"}
      </ReactMarkdown>
    </div>
  );
}

interface MilkdownEditorInnerProps {
  markdown: string;
  editable: boolean;
  autosaveRef: React.RefObject<DescriptionAutosave | null>;
  onOpenLink: (href: string) => void;
  resolveMention?: MentionResolver;
  onBlur: () => void;
}

/**
 * Inner Milkdown editor component. Must be rendered inside `MilkdownProvider`.
 * Separated so the provider wraps before `useEditor` runs.
 */
function MilkdownEditorInner({
  markdown,
  editable,
  autosaveRef,
  onOpenLink,
  resolveMention,
  onBlur,
}: MilkdownEditorInnerProps) {
  const onOpenLinkRef = useRef(onOpenLink);
  onOpenLinkRef.current = onOpenLink;

  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, markdown);
          ctx.set(editorViewOptionsCtx, {
            editable: () => editable,
            handleClickOn: (_view, _pos, _node, _nodePos, event) => {
              const anchor = (event.target as HTMLElement | null)?.closest("a");
              const href = anchor?.getAttribute("href");
              if (href) {
                event.preventDefault();
                onOpenLinkRef.current(href);
                return true;
              }
              return false;
            },
          });
          applyDescriptionConfig(ctx);
          ctx.get(listenerCtx).markdownUpdated((_ctx, md) => {
            autosaveRef.current?.update(md);
          });
          ctx.get(listenerCtx).blur(() => {
            onBlur();
          });
          configureDescriptionSlash(ctx);
          configureDescriptionTooltip(ctx);
        })
        .use(listener)
        .use(descriptionPlugins as MilkdownPlugin[])
        .use(
          resolveMention
            ? descriptionMentionPlugin(resolveMention, (href) =>
                onOpenLinkRef.current(href),
              )
            : [],
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return <Milkdown />;
}

interface DescriptionEditorProps {
  markdown: string;
  editable: boolean;
  onSave: (md: string) => Promise<void>;
  onOpenLink: (href: string) => void;
  resolveMention?: MentionResolver;
  onSaveStateChange?: (s: SaveStatus) => void;
}

export function DescriptionEditor({
  markdown,
  editable,
  onSave,
  onOpenLink,
  resolveMention,
  onSaveStateChange,
}: DescriptionEditorProps) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const autosaveRef = useRef<DescriptionAutosave | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // Create autosave on first edit, destroy on exit
  useEffect(() => {
    if (!editing) return;
    const queue = new DescriptionAutosave(
      markdown,
      (value) => onSaveRef.current(value),
      750,
    );
    autosaveRef.current = queue;
    const unsub = queue.subscribe((s) => {
      setStatus(s);
      onSaveStateChange?.(s);
    });
    return () => {
      unsub();
      void queue.flush().catch(() => undefined);
      queue.destroy();
      autosaveRef.current = null;
    };
    // We want this to run only when editing starts, not on markdown prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const handleBlur = () => {
    void autosaveRef.current?.flush().catch(() => undefined);
    setEditing(false);
    setStatus("idle");
  };

  const readOnlyNode = (
    <ReadOnlyDescription
      markdown={markdown}
      onOpenLink={onOpenLink}
      resolveMention={resolveMention}
    />
  );

  if (!editing) {
    return (
      <div
        onDoubleClick={() => {
          if (editable) setEditing(true);
        }}
      >
        {readOnlyNode}
      </div>
    );
  }

  return (
    <EditorErrorBoundary fallback={readOnlyNode}>
      <div
        className="relative"
        onBlur={(e) => {
          // Only blur when focus leaves the entire wrapper div (not internal moves)
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            handleBlur();
          }
        }}
      >
        <MilkdownProvider>
          <MilkdownEditorInner
            markdown={markdown}
            editable={editable}
            autosaveRef={autosaveRef}
            onOpenLink={onOpenLink}
            resolveMention={resolveMention}
            onBlur={handleBlur}
          />
        </MilkdownProvider>
        {editable && status !== "idle" && (
          <span
            className={`description-save-status description-save-status--${status}`}
            aria-live="polite"
          >
            {status === "dirty"
              ? "Saving soon…"
              : status === "saving"
                ? "Saving…"
                : status === "saved"
                  ? "Saved"
                  : "Couldn't save"}
          </span>
        )}
      </div>
    </EditorErrorBoundary>
  );
}
