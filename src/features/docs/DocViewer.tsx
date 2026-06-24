import { useMemo } from "react";
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
        .use(history),
    [markdown],
  );
  return <Milkdown />;
}

/** Render one doc's markdown read-only, with a react-markdown fallback. */
export function DocViewer({ markdown }: { markdown: string }) {
  const fallback = useMemo(
    () => <ReadOnlyDescription markdown={markdown} onOpenLink={openExternal} />,
    [markdown],
  );
  return (
    <EditorErrorBoundary key={markdown} fallback={fallback}>
      <article className="astryn-prose prose prose-sm prose-invert max-w-3xl px-8 py-6 prose-headings:font-semibold prose-a:text-primary">
        <MilkdownProvider key={markdown}>
          <DocMilkdown markdown={markdown} />
        </MilkdownProvider>
      </article>
    </EditorErrorBoundary>
  );
}
