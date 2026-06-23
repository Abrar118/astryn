import { useEffect, useRef } from "react";
import type { MilkdownPlugin } from "@milkdown/ctx";
import { Editor, defaultValueCtx, rootCtx, editorViewOptionsCtx, editorViewCtx } from "@milkdown/kit/core";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { ArrowUp, Paperclip } from "lucide-react";
import { pickAndUploadFiles, insertAssetsIntoView } from "../attachUpload";
import { descriptionPlugins, applyDescriptionConfig } from "../milkdownEditor";
import { configureDescriptionSlash, configureDescriptionTooltip } from "../milkdownMenus";
import { descriptionMentionPlugin } from "../milkdownMention";
import { type MentionResolver } from "../markdownComponents";
import { EditorErrorBoundary } from "../DescriptionEditor";
import { configureUserMention, userMentionTypeahead } from "./milkdownUserMention";
import type { UploadedAsset, User } from "@/lib/commands";

type InsertAssets = (assets: UploadedAsset[]) => void;

type Variant = "pinned" | "reply" | "edit";

interface Props {
  variant: Variant;
  initialMarkdown?: string;
  placeholder?: string;
  submitting: boolean;
  onSubmit: (markdown: string) => void;
  onCancel?: () => void;
  onOpenLink: (href: string) => void;
  resolveMention?: MentionResolver;
  users?: User[];
}

function ComposerInner({ markdownRef, insertRef, initialMarkdown, onOpenLink, resolveMention, users = [] }: {
  markdownRef: React.MutableRefObject<string>;
  insertRef: React.MutableRefObject<InsertAssets | null>;
  initialMarkdown: string;
  onOpenLink: (href: string) => void;
  resolveMention?: MentionResolver;
  users?: User[];
}) {
  const onOpenLinkRef = useRef(onOpenLink);
  onOpenLinkRef.current = onOpenLink;
  const usersRef = useRef(users);
  usersRef.current = users;

  // Drop the insert handle when this editor unmounts so a pending attach can't
  // dispatch into a destroyed ProseMirror view.
  useEffect(() => () => { insertRef.current = null; }, [insertRef]);

  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, initialMarkdown);
          ctx.set(editorViewOptionsCtx, {
            editable: () => true,
            handleClickOn: (_v, _p, _n, _np, event) => {
              const href = (event.target as HTMLElement | null)?.closest("a")?.getAttribute("href");
              if (href) { event.preventDefault(); onOpenLinkRef.current(href); return true; }
              return false;
            },
          });
          applyDescriptionConfig(ctx);
          ctx.get(listenerCtx).markdownUpdated((_c, md) => { markdownRef.current = md; });
          ctx.get(listenerCtx).mounted((c) => {
            const view = c.get(editorViewCtx);
            insertRef.current = (assets) => insertAssetsIntoView(view, assets);
            view.focus();
          });
          configureDescriptionSlash(ctx);
          configureDescriptionTooltip(ctx);
          configureUserMention(ctx, () => usersRef.current);
        })
        .use(listener)
        .use(descriptionPlugins as MilkdownPlugin[])
        .use(resolveMention ? descriptionMentionPlugin(resolveMention, (h) => onOpenLinkRef.current(h)) : [])
        .use(userMentionTypeahead()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return <Milkdown />;
}

/** Milkdown comment composer. Clears by remounting (parent bumps `key` on success). */
export function CommentComposer({
  variant, initialMarkdown = "", placeholder, submitting, onSubmit, onCancel, onOpenLink, resolveMention, users = [],
}: Props) {
  const markdownRef = useRef(initialMarkdown);
  const insertRef = useRef<InsertAssets | null>(null);

  const submit = () => {
    const md = markdownRef.current.trim();
    if (!md || submitting) return;
    onSubmit(md);
  };

  const attach = async () => {
    // Capture the live insert handle; only use it if the SAME editor is still
    // mounted when the upload resolves (the composer may have remounted).
    const insert = insertRef.current;
    const assets = await pickAndUploadFiles();
    if (assets.length > 0 && insertRef.current === insert) insert?.(assets);
  };

  return (
    <EditorErrorBoundary fallback={<div className="text-sm text-muted-foreground">Composer unavailable.</div>}>
      <div
        data-comment-composer={variant}
        className="rounded-xl border border-border bg-card focus-within:border-foreground/25"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
          if (e.key === "Escape" && onCancel) { e.preventDefault(); onCancel(); }
        }}
      >
        <div
          className="comment-composer-prose max-h-56 overflow-y-auto px-3 py-2 text-sm"
          style={{ ["--milkdown-placeholder" as string]: `"${placeholder ?? (variant === "reply" ? "Leave a reply…" : "Leave a comment…")}"` } as React.CSSProperties}
        >
          <MilkdownProvider>
            <ComposerInner
              markdownRef={markdownRef}
              insertRef={insertRef}
              initialMarkdown={initialMarkdown}
              onOpenLink={onOpenLink}
              resolveMention={resolveMention}
              users={users}
            />
          </MilkdownProvider>
        </div>
        <div className="flex items-center gap-2 px-2 pb-2">
          <button
            type="button"
            aria-label="Attach images, files, or videos"
            title="Attach images, files, or videos"
            onMouseDown={(e) => e.preventDefault()}
            onClick={attach}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Paperclip className="size-4" />
          </button>
          <div className="flex-1" />
          {onCancel && (
            <button type="button" onClick={onCancel}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Cancel
            </button>
          )}
          <button
            type="button"
            aria-label="Send comment"
            title="Send (⌘↵)"
            disabled={submitting}
            onClick={submit}
            className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </div>
    </EditorErrorBoundary>
  );
}
