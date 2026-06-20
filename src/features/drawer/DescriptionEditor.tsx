import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MilkdownPlugin } from "@milkdown/ctx";
import { Editor } from "@milkdown/kit/core";
import {
  defaultValueCtx,
  rootCtx,
  editorViewOptionsCtx,
  editorViewCtx,
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
          ctx.get(listenerCtx).mounted((mountedCtx) => {
            // Focus the ProseMirror view once the editor is fully mounted so
            // the user can start typing immediately after double-clicking.
            const editorView = mountedCtx.get(editorViewCtx);
            editorView.focus();
          });
          // NOTE: We do NOT register a listenerCtx.blur() here.
          // The slash/tooltip menus are appended to document.body (outside the
          // wrapper div), so focusing the URL input blurs ProseMirror and would
          // fire blur → onBlur() → close the edit session before the user can
          // type. Blur is handled exclusively via the wrapper div's onBlur with
          // a containment + data-md-menu check (see DescriptionEditor render).
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
  const autosaveRef = useRef<DescriptionAutosave | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  /** Guard against duplicate blur invocations while an async flush is in flight. */
  const blurInFlightRef = useRef(false);

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
      onSaveStateChange?.(s);
    });
    return () => {
      unsub();
      // Flush before destroying so any pending draft is saved when the
      // component unmounts without a prior blur (e.g. the user clicks an
      // in-editor issue mention which remounts the key={id} editor). flush()
      // is idempotent: it early-returns when nothing is pending or when an
      // in-flight save is already underway, so double-flushing with handleBlur
      // is harmless.
      void queue.flush().catch(() => undefined);
      queue.destroy();
      autosaveRef.current = null;
    };
    // We want this to run only when editing starts, not on markdown prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const handleBlur = () => {
    // Guard against duplicate invocations (e.g. both the blur listener and the
    // wrapper's onBlur firing for the same focus-leave event).
    if (blurInFlightRef.current) return;
    blurInFlightRef.current = true;
    const queue = autosaveRef.current;
    if (!queue) {
      setEditing(false);
      blurInFlightRef.current = false;
      return;
    }
    // Await the flush while still subscribed so status propagates correctly.
    // Only exit edit mode and reset the flag after the flush settles.
    queue.flush().then(
      () => {
        setEditing(false);
        onSaveStateChange?.("idle");
        blurInFlightRef.current = false;
      },
      () => {
        // On failure: do NOT exit edit mode. Staying in editing=true means the
        // Milkdown editor (and its draft) remain visible so the user can retry.
        // The error status is already dispatched by the queue's subscriber, and
        // the one-shot toast in the drawer breadcrumb effect will surface it.
        // Reset the re-entrancy guard so a subsequent blur can trigger another
        // flush attempt.
        blurInFlightRef.current = false;
      },
    );
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
          const relatedTarget = e.relatedTarget as Element | null;
          // 1. Internal focus moves within the wrapper: ignore.
          if (e.currentTarget.contains(relatedTarget)) return;
          // 2. Focus moving into a body-portalled menu (slash / tooltip):
          //    ignore so the URL input or slash list stays usable without
          //    closing the edit session.
          if (relatedTarget?.closest?.("[data-md-menu]")) return;
          handleBlur();
        }}
      >
        <MilkdownProvider>
          <MilkdownEditorInner
            markdown={markdown}
            editable={editable}
            autosaveRef={autosaveRef}
            onOpenLink={onOpenLink}
            resolveMention={resolveMention}
          />
        </MilkdownProvider>
      </div>
    </EditorErrorBoundary>
  );
}
