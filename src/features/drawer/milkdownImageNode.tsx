import { createRoot } from "react-dom/client";
import type { Node as ProseMirrorNode } from "@milkdown/prose/model";
import type { NodeViewConstructor } from "@milkdown/prose/view";
import { $view } from "@milkdown/kit/utils";
import { imageSchema } from "@milkdown/kit/preset/commonmark";
import { LinearMarkdownImage } from "./LinearMarkdownImage";

/**
 * React component used exclusively to pass src/alt into LinearMarkdownImage.
 * Never mutates node attrs — the data: URL lives only in LinearMarkdownImage's
 * DOM state and never escapes into ProseMirror attrs or serialized markdown.
 */
function MilkdownImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="my-2">
      <LinearMarkdownImage src={src} alt={alt} />
    </div>
  );
}

/**
 * ProseMirror NodeView factory that mounts MilkdownImage via React.
 * Schema + markdown parse/serialize remain the commonmark defaults so the
 * original URL round-trips unchanged.
 */
function makeImageNodeView(): NodeViewConstructor {
  return (node: ProseMirrorNode) => {
    const dom = document.createElement("div");
    dom.setAttribute("data-milkdown-image", "");

    const attrs = node.attrs as { src?: string; alt?: string };
    const root = createRoot(dom);
    root.render(<MilkdownImage src={attrs.src ?? ""} alt={attrs.alt ?? ""} />);

    return {
      dom,
      // No contentDOM — image is a leaf node.
      update(updatedNode: ProseMirrorNode) {
        if (updatedNode.type !== node.type) return false;
        const next = updatedNode.attrs as { src?: string; alt?: string };
        root.render(
          <MilkdownImage src={next.src ?? ""} alt={next.alt ?? ""} />,
        );
        return true;
      },
      destroy() {
        root.unmount();
      },
    };
  };
}

/**
 * Milkdown $view plugin that overrides the commonmark image node's DOM
 * rendering with the LinearMarkdownImage proxy.
 *
 * Registered against imageSchema.node ($Node), not the $NodeSchema wrapper,
 * as required by the $view signature: $view($Node | $Mark, factory).
 */
export const descriptionImageView = $view(
  imageSchema.node,
  (_ctx) => makeImageNodeView(),
);
