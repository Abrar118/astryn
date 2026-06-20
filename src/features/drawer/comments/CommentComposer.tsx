import { useRef } from "react";
import type { MilkdownPlugin } from "@milkdown/ctx";
import { Editor, defaultValueCtx, rootCtx, editorViewOptionsCtx, editorViewCtx } from "@milkdown/kit/core";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { ArrowUp } from "lucide-react";
import { descriptionPlugins, applyDescriptionConfig } from "../milkdownEditor";
import { configureDescriptionSlash, configureDescriptionTooltip } from "../milkdownMenus";
import { descriptionMentionPlugin } from "../milkdownMention";
import { type MentionResolver } from "../markdownComponents";
import { EditorErrorBoundary } from "../DescriptionEditor";
import { configureUserMention, userMentionTypeahead } from "./milkdownUserMention";
import type { User } from "@/lib/commands";

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

function ComposerInner({ markdownRef, initialMarkdown, onOpenLink, resolveMention, users = [] }: {
  markdownRef: React.MutableRefObject<string>;
  initialMarkdown: string;
  onOpenLink: (href: string) => void;
  resolveMention?: MentionResolver;
  users?: User[];
}) {
  const onOpenLinkRef = useRef(onOpenLink);
  onOpenLinkRef.current = onOpenLink;
  const usersRef = useRef(users);
  usersRef.current = users;

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
          ctx.get(listenerCtx).mounted((c) => c.get(editorViewCtx).focus());
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

  const submit = () => {
    const md = markdownRef.current.trim();
    if (!md || submitting) return;
    onSubmit(md);
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
          data-placeholder={placeholder ?? (variant === "reply" ? "Leave a reply…" : "Leave a comment…")}
        >
          <MilkdownProvider>
            <ComposerInner
              markdownRef={markdownRef}
              initialMarkdown={initialMarkdown}
              onOpenLink={onOpenLink}
              resolveMention={resolveMention}
              users={users}
            />
          </MilkdownProvider>
        </div>
        <div className="flex items-center justify-end gap-2 px-2 pb-2">
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
