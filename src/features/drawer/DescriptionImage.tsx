import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { LinearMarkdownImage } from "./LinearMarkdownImage";

/**
 * Tiptap NodeView for inline images in the description editor.
 *
 * Reads `node.attrs.src` (the original Linear URL) and renders it through the
 * same proxy path used by `LinearMarkdownImage`. The proxied `data:` URL lives
 * only in the DOM — `node.attrs.src` is never mutated, so serialization via
 * `markdownFromEditor` always emits the original URL.
 */
export function DescriptionImage({ node }: NodeViewProps) {
  const src: string = node.attrs.src ?? "";
  const alt: string = node.attrs.alt ?? "";

  // Block-level image node (inline: false) — use a block wrapper.
  return (
    <NodeViewWrapper className="my-2">
      <LinearMarkdownImage src={src} alt={alt} />
    </NodeViewWrapper>
  );
}
