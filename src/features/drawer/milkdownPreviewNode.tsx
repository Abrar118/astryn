import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import type { Node as ProseMirrorNode } from "@milkdown/prose/model";
import type { EditorView, NodeViewConstructor } from "@milkdown/prose/view";
import { $view } from "@milkdown/kit/utils";
import { paragraphSchema } from "@milkdown/kit/preset/commonmark";
import { openUrl } from "@tauri-apps/plugin-opener";
import { safeExternalUrl } from "@/lib/links";
import { classifyUrlParagraph, hostLabel } from "./urlPreview";
import { isUploadAttachment } from "./markdownComponents";
import { FileAttachmentCard } from "./FileAttachmentCard";
import { fetchLinkPreview, type LinkPreview } from "@/lib/commands";

/** Read the sole text + its link href/title from a paragraph node, or null shape. */
export function readParagraph(node: ProseMirrorNode): {
  text: string;
  linkHref: string | null;
  linkTitle: string | null;
} {
  if (node.childCount !== 1) return { text: "", linkHref: null, linkTitle: null };
  const child = node.child(0);
  if (!child.isText) return { text: "", linkHref: null, linkTitle: null };
  const linkMark = child.marks.find((m) => m.type.name === "link");
  const href = (linkMark?.attrs.href as string | undefined) ?? null;
  const linkTitle = (linkMark?.attrs.title as string | undefined) ?? null;
  return { text: child.text ?? "", linkHref: href, linkTitle };
}

function openExternal(href: string) {
  const safe = safeExternalUrl(href);
  if (safe) void openUrl(safe).catch(() => undefined);
}

/**
 * Read-only preview card for a standalone bare URL. Fetches metadata via the
 * Rust command (presentation only — never dispatches a ProseMirror transaction)
 * and opens the link through the external-link handler (the webview never
 * navigates directly). Shown only on the read-only display editor.
 */
function PreviewCard({ url }: { url: string }) {
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

/**
 * Paragraph node view that renders a standalone bare-URL paragraph as a preview
 * card. Registered ONLY on the read-only display editor (see DescriptionEditor):
 * previews are a display-time affordance, and editing stays on stock paragraphs
 * so the embed doesn't re-render/re-fetch per keystroke while a URL is typed.
 * The `view.editable` guards are defensive — this view should never run editable.
 */
/** Read-only classification of a paragraph: an uploaded-file card, a bare-URL
 *  preview card, or a normal paragraph. Editable always stays "default". */
function classifyParagraph(node: ProseMirrorNode, view: EditorView): "attachment" | "preview" | "default" {
  if (view.editable) return "default";
  const para = readParagraph(node);
  if (para.linkHref && isUploadAttachment(para.linkHref)) return "attachment";
  if (classifyUrlParagraph(para) === "preview") return "preview";
  return "default";
}

export function createPreviewNodeView(): NodeViewConstructor {
  return (node: ProseMirrorNode, view: EditorView) => {
    if (classifyParagraph(node, view) === "default") {
      // Default paragraph rendering (editable, plain text, or a normal link).
      const p = document.createElement("p");
      return {
        dom: p,
        contentDOM: p,
        update: (updated: ProseMirrorNode) =>
          updated.type === node.type && classifyParagraph(updated, view) === "default",
      };
    }

    // Read-only island: an opaque presentation card, no contentDOM.
    const dom = document.createElement("div");
    dom.setAttribute("data-milkdown-preview", "");
    const root = createRoot(dom);
    const render = (n: ProseMirrorNode) => {
      const para = readParagraph(n);
      if (para.linkHref && isUploadAttachment(para.linkHref)) {
        const href = para.linkHref;
        root.render(
          <FileAttachmentCard
            filename={para.text.trim()}
            size={para.linkTitle}
            title={href}
            onOpen={() => openExternal(href)}
          />,
        );
      } else {
        root.render(<PreviewCard url={para.text.trim()} />);
      }
    };
    render(node);
    return {
      dom,
      ignoreMutation: () => true,
      update(updated: ProseMirrorNode) {
        if (updated.type !== node.type || classifyParagraph(updated, view) === "default") return false;
        render(updated);
        return true;
      },
      destroy() {
        root.unmount();
      },
    };
  };
}

/** $view override of the paragraph node for standalone-URL previews. */
export const descriptionPreviewView = $view(
  paragraphSchema.node,
  () => createPreviewNodeView(),
);
