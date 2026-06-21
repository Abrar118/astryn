import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import type { Node as ProseMirrorNode } from "@milkdown/prose/model";
import type { EditorView, NodeViewConstructor } from "@milkdown/prose/view";
import { $view } from "@milkdown/kit/utils";
import { paragraphSchema } from "@milkdown/kit/preset/commonmark";
import { openUrl } from "@tauri-apps/plugin-opener";
import { safeExternalUrl } from "@/lib/links";
import { classifyUrlParagraph, hostLabel } from "./urlPreview";
import { fetchLinkPreview, type LinkPreview } from "@/lib/commands";

/** Read the sole text + its link href from a paragraph node, or null shape. */
export function readParagraph(node: ProseMirrorNode): { text: string; linkHref: string | null } {
  if (node.childCount !== 1) return { text: "", linkHref: null };
  const child = node.child(0);
  if (!child.isText) return { text: "", linkHref: null };
  const linkMark = child.marks.find((m) => m.type.name === "link");
  const href = (linkMark?.attrs.href as string | undefined) ?? null;
  return { text: child.text ?? "", linkHref: href };
}

function openExternal(href: string) {
  const safe = safeExternalUrl(href);
  if (safe) void openUrl(safe).catch(() => undefined);
}

function PreviewCard({ url, editable }: { url: string; editable: boolean }) {
  const [data, setData] = useState<LinkPreview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setData(null);
    setFailed(false);
    fetchLinkPreview(url)
      .then((p) => { if (active) setData(p); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [url]);

  const host = hostLabel(url);

  if (failed) {
    return (
      <button type="button" className="md-preview-fallback" onClick={() => openExternal(url)}>
        {url}
      </button>
    );
  }
  if (!data) {
    return (
      <div className="md-preview-card md-preview-loading" aria-busy="true">
        <span className="md-preview-host">{host}</span>
      </div>
    );
  }

  const title = data.title ?? host;
  if (editable) {
    return (
      <div className="md-preview-row">
        {data.imageDataUrl && <img className="md-preview-fav" src={data.imageDataUrl} alt="" />}
        <span className="md-preview-title">{title}</span>
        <span className="md-preview-host">{host}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="md-preview-card"
      onClick={() => openExternal(data.resolvedUrl || url)}
      title={data.resolvedUrl || url}
    >
      {data.imageDataUrl && <img className="md-preview-thumb" src={data.imageDataUrl} alt="" />}
      <span className="md-preview-text">
        <span className="md-preview-title">{title}</span>
        {data.description && <span className="md-preview-desc">{data.description}</span>}
        <span className="md-preview-host">{data.siteName ?? host}</span>
      </span>
    </button>
  );
}

export function createPreviewNodeView(): NodeViewConstructor {
  return (node: ProseMirrorNode, view: EditorView) => {
    const isPreview = () => classifyUrlParagraph(readParagraph(node)) === "preview";

    if (!isPreview()) {
      // Default paragraph: editable contentDOM, no custom UI. The `update`
      // hook is REQUIRED: without it ProseMirror recreates the node view on
      // every change, tearing down the DOM the selection lives in and breaking
      // typing/Enter for all normal paragraphs. Keep the view while the node
      // stays a non-preview paragraph; return false only when it becomes a
      // preview so a fresh node view picks up the preview branch.
      const p = document.createElement("p");
      return {
        dom: p,
        contentDOM: p,
        update(updated: ProseMirrorNode) {
          if (updated.type !== node.type) return false;
          return classifyUrlParagraph(readParagraph(updated)) !== "preview";
        },
      };
    }

    const url = readParagraph(node).text.trim();

    if (!view.editable) {
      // Read-only: opaque presentation card, no contentDOM.
      const dom = document.createElement("div");
      dom.setAttribute("data-milkdown-preview", "");
      const root = createRoot(dom);
      root.render(<PreviewCard url={url} editable={false} />);
      return {
        dom,
        ignoreMutation: () => true,
        update(updated: ProseMirrorNode) {
          if (updated.type !== node.type) return false;
          if (classifyUrlParagraph(readParagraph(updated)) !== "preview") return false;
          root.render(<PreviewCard url={readParagraph(updated).text.trim()} editable={false} />);
          return true;
        },
        destroy() { root.unmount(); },
      };
    }

    // Edit mode: single-row chrome + an editable contentDOM holding the URL so
    // the original URL is always editable inline (Enter/typing edits it).
    const dom = document.createElement("div");
    dom.className = "md-preview-edit";
    const chrome = document.createElement("div");
    chrome.setAttribute("contenteditable", "false");
    const root = createRoot(chrome);
    root.render(<PreviewCard url={url} editable />);
    const content = document.createElement("p");
    content.className = "md-preview-edit-url";
    dom.appendChild(chrome);
    dom.appendChild(content);
    return {
      dom,
      contentDOM: content,
      ignoreMutation: (m) => !content.contains(m.target as Node),
      update(updated: ProseMirrorNode) {
        if (updated.type !== node.type) return false;
        if (classifyUrlParagraph(readParagraph(updated)) !== "preview") return false;
        root.render(<PreviewCard url={readParagraph(updated).text.trim()} editable />);
        return true;
      },
      destroy() { root.unmount(); },
    };
  };
}

/** $view override of the paragraph node for standalone-URL previews. */
export const descriptionPreviewView = $view(
  paragraphSchema.node,
  () => createPreviewNodeView(),
);
