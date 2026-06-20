import { createRoot } from "react-dom/client";
import type { Node as ProseMirrorNode } from "@milkdown/prose/model";
import type { EditorView, NodeViewConstructor } from "@milkdown/prose/view";
import { $view } from "@milkdown/kit/utils";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import { MermaidDiagram } from "./MermaidDiagram";

/**
 * NodeView for code blocks. A `mermaid` code block renders as a diagram while
 * the editor is read-only (non-editable); in edit mode — and for every other
 * language — it falls back to the default editable `<pre><code>` so the source
 * stays editable. Mirrors the read-only render path's mermaid behavior, so the
 * description looks the same whether it's displayed via Milkdown or react-markdown.
 */
export function createCodeBlockNodeView(): NodeViewConstructor {
  return (node: ProseMirrorNode, view: EditorView) => {
    const isMermaid = (node.attrs.language as string | undefined) === "mermaid";

    if (isMermaid && !view.editable) {
      const dom = document.createElement("div");
      dom.setAttribute("data-milkdown-mermaid", "");
      const root = createRoot(dom);
      root.render(<MermaidDiagram code={node.textContent} />);
      return {
        dom,
        // React owns this subtree and there is no contentDOM — ignore all
        // mutations so ProseMirror treats the diagram as an opaque node.
        ignoreMutation: () => true,
        update(updated: ProseMirrorNode) {
          if (updated.type !== node.type) return false;
          if ((updated.attrs.language as string | undefined) !== "mermaid") return false;
          root.render(<MermaidDiagram code={updated.textContent} />);
          return true;
        },
        destroy() {
          root.unmount();
        },
      };
    }

    // Default code block: the commonmark schema's own DOM shape (<pre><code>),
    // with the <code> as the editable contentDOM.
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    const language = node.attrs.language as string | undefined;
    if (language) code.setAttribute("data-language", language);
    pre.appendChild(code);
    return { dom: pre, contentDOM: code };
  };
}

/**
 * Milkdown $view plugin overriding the commonmark code-block node's rendering.
 * Registered against `codeBlockSchema.node` ($Node), as required by $view.
 */
export const descriptionCodeBlockView = $view(
  codeBlockSchema.node,
  () => createCodeBlockNodeView(),
);
