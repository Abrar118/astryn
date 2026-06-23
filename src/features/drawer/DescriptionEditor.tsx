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
  serializerCtx,
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
import { descriptionPreviewView } from "./milkdownPreviewNode";
import { createMarkdownComponents, mentionAwareUrlTransform, type MentionResolver } from "./markdownComponents";
import type { User } from "@/lib/commands";
import { createUserMentionRemarkPlugin } from "./remarkUserMentions";

/** Build a mention→user resolver: by our id first, then by display name / handle. */
export function makeUserResolver(users: User[]) {
  return ({ id, name }: { id: string | null; name: string }): User | undefined => {
    if (id) {
      const byId = users.find((u) => u.id === id);
      if (byId) return byId;
    }
    const key = name.toLowerCase();
    return users.find(
      (u) => u.name.toLowerCase() === key || (u.displayName ?? "").toLowerCase() === key,
    );
  };
}

/**
 * Some Linear descriptions contain Markdown that ProseMirror rejects (e.g. a
 * code span that is also a link, an image as a bare list item, or duplicate
 * marks from malformed `**`). This boundary catches that so the drawer shows
 * the description read-only instead of crashing the whole app.
 */
export class EditorErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode; onError?: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.warn("[astryn] description editor could not render; showing read-only view", error);
    // Let the owner react (e.g. drop back out of edit mode) so it isn't left in
    // an editing state that only renders the read-only fallback.
    this.props.onError?.();
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
  users,
}: {
  markdown: string;
  onOpenLink: (href: string) => void;
  resolveMention?: MentionResolver;
  users?: User[];
}) {
  const components = useMemo(
    () =>
      createMarkdownComponents({
        onActivateLink: onOpenLink,
        resolveMention: resolveMention ?? (() => undefined),
        resolveUser: users ? makeUserResolver(users) : undefined,
      }),
    [onOpenLink, resolveMention, users],
  );
  const userMentionPlugin = useMemo(
    () => createUserMentionRemarkPlugin(users ?? []),
    [users],
  );
  return (
    <div className="astryn-prose prose prose-sm prose-invert max-w-none prose-headings:font-semibold prose-a:text-primary">
      <ReactMarkdown remarkPlugins={[remarkGfm, userMentionPlugin]} components={components} urlTransform={mentionAwareUrlTransform}>
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
  /** Persist a checkbox toggle made outside edit mode (display instance). */
  onPersist: (md: string) => void;
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
  onPersist,
}: MilkdownEditorInnerProps) {
  const onOpenLinkRef = useRef(onOpenLink);
  onOpenLinkRef.current = onOpenLink;
  const onPersistRef = useRef(onPersist);
  onPersistRef.current = onPersist;

  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, markdown);
          ctx.set(editorViewOptionsCtx, {
            editable: () => editable,
            handleClickOn: (view, _pos, _node, _nodePos, event) => {
              const target = event.target as HTMLElement | null;
              // ── Task-list checkbox toggle ──────────────────────────────────
              // The checkbox is a CSS ::before in the item's left padding, so a
              // click on it lands on the <li>; toggle when the click x falls in
              // that band. Works in display mode too (persist directly); in edit
              // mode the markdownUpdated listener autosaves the change.
              const li = target?.closest('li[data-item-type="task"]') as HTMLElement | null;
              if (li) {
                const rect = li.getBoundingClientRect();
                if (event.clientX - rect.left <= 24) {
                  const $pos = view.state.doc.resolve(view.posAtDOM(li, 0));
                  for (let depth = $pos.depth; depth >= 1; depth--) {
                    const item = $pos.node(depth);
                    if (item.attrs?.checked != null) {
                      view.dispatch(
                        view.state.tr.setNodeMarkup($pos.before(depth), undefined, {
                          ...item.attrs,
                          checked: !item.attrs.checked,
                        }),
                      );
                      if (!autosaveRef.current) {
                        onPersistRef.current(ctx.get(serializerCtx)(view.state.doc));
                      }
                      event.preventDefault();
                      return true;
                    }
                  }
                }
              }
              // ── In-app link activation ─────────────────────────────────────
              const anchor = target?.closest("a");
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
            // the user can start typing immediately after double-clicking. Only
            // in edit mode — the read-only display instance must not steal focus
            // or scroll the drawer.
            if (!editable) return;
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
        // Link-preview cards render only on the read-only/display editor.
        // While editing, a standalone URL stays plain editable text — a
        // deliberate UX choice so the embed doesn't re-render and re-fetch
        // metadata on every keystroke as the URL is typed. (Canonical Markdown
        // is unchanged either way; the card is pure presentation.)
        .use(editable ? [] : ([descriptionPreviewView] as unknown as MilkdownPlugin[]))
        .use(
          resolveMention
            ? descriptionMentionPlugin(resolveMention, (href) =>
                onOpenLinkRef.current(href),
              )
            : [],
        ),
    // Rebuild the read-only editor when the issue cache changes so links that
    // initially missed `resolveMention` are upgraded to pills. While editing,
    // keep the resolver dependency stable to avoid replacing an unsaved draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editable, editable ? null : resolveMention],
  );

  return <Milkdown />;
}

interface DescriptionEditorProps {
  markdown: string;
  editable: boolean;
  onSave: (md: string) => Promise<void>;
  onOpenLink: (href: string) => void;
  resolveMention?: MentionResolver;
  users?: User[];
  onSaveStateChange?: (s: SaveStatus) => void;
  /**
   * Fired when a save fails on unmount (e.g. the user switches issues, which
   * remounts the key={id} editor) — by then the save-state subscription is torn
   * down, so this is the only signal left to surface the failure.
   */
  onSaveError?: () => void;
}

export function DescriptionEditor({
  markdown,
  editable,
  onSave,
  onOpenLink,
  resolveMention,
  users,
  onSaveStateChange,
  onSaveError,
}: DescriptionEditorProps) {
  const [editing, setEditing] = useState(false);
  const autosaveRef = useRef<DescriptionAutosave | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onSaveErrorRef = useRef(onSaveError);
  onSaveErrorRef.current = onSaveError;
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
      // is harmless. force=true so a prior debounce failure (which latches the
      // failed flag) still gets a terminal retry instead of no-op'ing — otherwise
      // switching issues would silently discard the failed draft. We've already
      // unsubscribed, so a failure here can't reach onSaveStateChange — surface
      // it via onSaveError instead of swallowing it.
      void queue.flush(true).catch(() => onSaveErrorRef.current?.());
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
    // Only exit edit mode and reset the flag after the flush settles. force=true
    // so a blur after a prior failure retries the save instead of resolving as a
    // no-op (which would exit edit mode and discard the unsaved draft).
    queue.flush(true).then(
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
      users={users}
    />
  );

  // Empty description: a muted, double-clickable affordance (no point mounting a
  // ProseMirror instance to render nothing). Editing starts an empty editor.
  if (!editing && !markdown.trim()) {
    return (
      <div
        onDoubleClick={() => {
          if (editable) setEditing(true);
        }}
      >
        <p className="text-sm italic text-muted-foreground">No description</p>
      </div>
    );
  }

  // Render the description with Milkdown in BOTH modes — read-only (non-editable)
  // for display, editable while editing — so the two never diverge. The
  // react-markdown `readOnlyNode` remains only as the EditorErrorBoundary
  // fallback for the rare markdown that ProseMirror refuses to parse.
  //
  // `editorKey` remounts the boundary (and the editor) when toggling edit and —
  // in display mode — whenever the saved markdown changes, so background syncs
  // stay live AND a corrected description re-engages the editor instead of being
  // stuck on the latched fallback. While editing the key is constant so an
  // in-flight edit is never clobbered. onError drops back out of edit mode if the
  // editor throws, so we never sit editing-but-showing-fallback (which would also
  // freeze the content-change reset, since the key is constant while editing).
  const editorKey = editing ? "edit" : `view:${markdown}`;
  return (
    <EditorErrorBoundary
      key={editorKey}
      onError={() => setEditing(false)}
      fallback={
        <div
          onDoubleClick={() => {
            if (editable && !editing) setEditing(true);
          }}
        >
          {readOnlyNode}
        </div>
      }
    >
      <div
        className="relative"
        data-editing={editing}
        onDoubleClick={() => {
          if (editable && !editing) setEditing(true);
        }}
        onBlur={(e) => {
          if (!editing) return;
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
        <MilkdownProvider key={editorKey}>
          <MilkdownEditorInner
            markdown={markdown}
            editable={editing}
            autosaveRef={autosaveRef}
            onOpenLink={onOpenLink}
            resolveMention={resolveMention}
            onPersist={(md) => void onSaveRef.current(md)}
          />
        </MilkdownProvider>
      </div>
    </EditorErrorBoundary>
  );
}
