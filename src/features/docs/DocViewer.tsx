import { useEffect, useMemo, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { MilkdownPlugin } from "@milkdown/ctx";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewOptionsCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import {
  EditorErrorBoundary,
  ReadOnlyDescription,
} from "@/features/drawer/DescriptionEditor";
import { applyDescriptionConfig } from "@/features/drawer/milkdownEditor";
import { descriptionCodeBlockView } from "@/features/drawer/milkdownCodeBlock";
import { headingAt, lineOffset, pickHeading } from "./docFocus";

/** Open http(s) links in the system browser; ignore in-doc relative anchors. */
function openExternal(href: string) {
  if (/^https?:\/\//i.test(href)) void openUrl(href).catch(() => undefined);
}

function DocMilkdown({ markdown }: { markdown: string }) {
  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, markdown);
          ctx.set(editorViewOptionsCtx, {
            editable: () => false,
            handleClickOn: (_view, _pos, _node, _nodePos, event) => {
              const anchor = (event.target as HTMLElement | null)?.closest("a");
              const href = anchor?.getAttribute("href");
              if (href) {
                event.preventDefault();
                openExternal(href);
                return true;
              }
              return false;
            },
          });
          applyDescriptionConfig(ctx);
        })
        .use(commonmark as MilkdownPlugin[])
        .use(gfm as MilkdownPlugin[])
        .use(history)
        .use(descriptionCodeBlockView),
    [markdown],
  );
  return <Milkdown />;
}

/** Scroll to the heading `focusLine` falls under once the editor has drawn it, then call `onFocused`. */
function useScrollToHeading(
  root: React.RefObject<HTMLElement | null>,
  markdown: string,
  focusLine: number | null | undefined,
  onFocused?: () => void,
) {
  useEffect(() => {
    if (!focusLine) return;
    const target = headingAt(markdown, focusLine);
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      const headings = [...(root.current?.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6") ?? [])];
      const el = target && pickHeading(headings, target);
      if (el || !target || ++tries > 60) {
        el?.scrollIntoView({ block: "start" });
        onFocused?.();
      } else {
        frame = requestAnimationFrame(attempt); // the editor draws a moment after mount
      }
    };
    attempt();
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown, focusLine]);
}

/** Plain text, shown as written; scrolls to `focusLine` when given. */
export function PlainTextViewer({
  text,
  focusLine,
  onFocused,
}: {
  text: string;
  focusLine?: number | null;
  onFocused?: () => void;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!focusLine) return;
    anchor.current?.scrollIntoView({ block: "start" });
    onFocused?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, focusLine]);
  const at = focusLine ? lineOffset(text, focusLine) : 0;
  return (
    <pre className="docs-reader whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-foreground">
      {text.slice(0, at)}
      <span ref={anchor} />
      {text.slice(at)}
    </pre>
  );
}

/** Render one doc's markdown read-only, with a react-markdown fallback. */
export function DocViewer({
  markdown,
  focusLine,
  onFocused,
}: {
  markdown: string;
  /** Scroll to the section containing this 1-based line. */
  focusLine?: number | null;
  onFocused?: () => void;
}) {
  const article = useRef<HTMLElement>(null);
  useScrollToHeading(article, markdown, focusLine, onFocused);
  const fallback = useMemo(
    () => (
      <div className="docs-reader">
        <ReadOnlyDescription markdown={markdown} onOpenLink={openExternal} />
      </div>
    ),
    [markdown],
  );
  return (
    <EditorErrorBoundary key={markdown} fallback={fallback}>
      <article ref={article} className="astryn-prose docs-reader">
        <MilkdownProvider key={markdown}>
          <DocMilkdown markdown={markdown} />
        </MilkdownProvider>
      </article>
    </EditorErrorBoundary>
  );
}
