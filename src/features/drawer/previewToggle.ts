import type { Ctx } from "@milkdown/kit/ctx";
import { editorViewCtx } from "@milkdown/kit/core";
import { findParentNode } from "@milkdown/prose";
import type { EditorView } from "@milkdown/prose/view";
import { classifyUrlParagraph, hostLabel, type UrlParaKind } from "./urlPreview";
import { readParagraph } from "./milkdownPreviewNode";

export function togglePreviewLabel(kind: UrlParaKind): string | null {
  if (kind === "preview") return "Display as link";
  if (kind === "link") return "Display as preview";
  return null;
}

/**
 * The toggle kind for the paragraph at the current selection, or "none".
 * Takes the live `EditorView` directly — callers (tooltip shouldShow/update)
 * MUST pass the view ProseMirror hands them. Re-fetching the view from `ctx`
 * here is unsafe: during `readDOMChange` (which applies typed input / Enter)
 * `ctx.get(editorViewCtx)` can be undefined, and throwing there breaks editing.
 */
export function selectionUrlKind(view: EditorView): UrlParaKind {
  const found = findParentNode((n) => n.type.name === "paragraph")(view.state.selection);
  if (!found) return "none";
  return classifyUrlParagraph(readParagraph(found.node));
}

/**
 * Rewrite the current URL paragraph between preview (bare URL text) and
 * labeled-link (host label + link mark) forms. A normal transaction, so it
 * participates in undo/redo and flows through autosave.
 */
export function runPreviewToggle(ctx: Ctx): void {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const found = findParentNode((n) => n.type.name === "paragraph")(state.selection);
  if (!found) return;
  const { node, pos } = found;
  const parsed = readParagraph(node);
  const kind = classifyUrlParagraph(parsed);
  const url = parsed.text.trim();
  const linkType = state.schema.marks.link;
  if (!linkType) return;

  const start = pos + 1;
  const end = start + node.content.size;

  if (kind === "preview") {
    // → labeled link: host label text carrying a link mark to the URL.
    const label = hostLabel(url);
    const linked = state.schema.text(label, [linkType.create({ href: url })]);
    view.dispatch(state.tr.replaceWith(start, end, linked));
  } else if (kind === "link") {
    // → preview: bare URL text, no marks.
    const href = parsed.linkHref ?? url;
    const bare = state.schema.text(href);
    view.dispatch(state.tr.replaceWith(start, end, bare));
  }
}
