import { createRoot } from "react-dom/client";
import type { Node as ProseMirrorNode } from "@milkdown/prose/model";
import type { EditorView, NodeViewConstructor } from "@milkdown/prose/view";
import { $view } from "@milkdown/kit/utils";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import { MermaidDiagram } from "./MermaidDiagram";
import { resolveLanguage, highlightToReact } from "./milkdownCodeHighlight";

/** Languages offered in the edit-mode selector. "" = plain text. */
const CODE_LANGUAGES: { value: string; label: string }[] = [
  { value: "", label: "Plain text" },
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "tsx", label: "TSX" },
  { value: "python", label: "Python" },
  { value: "rust", label: "Rust" },
  { value: "bash", label: "Bash" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "sql", label: "SQL" },
  { value: "go", label: "Go" },
  { value: "java", label: "Java" },
  { value: "css", label: "CSS" },
  { value: "html", label: "HTML" },
  { value: "markdown", label: "Markdown" },
  { value: "mermaid", label: "Mermaid" },
];

function ReadOnlyCodeBlock({ code, language }: { code: string; language?: string }) {
  const label = resolveLanguage(language) ?? (language?.trim() || "text");
  const onCopy = () => {
    void navigator.clipboard.writeText(code).catch(() => {
      // Clipboard denied: leave the block unchanged; no global toast.
    });
  };
  return (
    <div className="md-codeblock" data-language={language ?? ""}>
      <div className="md-codeblock-header">
        <span className="md-codeblock-lang">{label}</span>
        <button type="button" className="md-codeblock-copy" onClick={onCopy} aria-label="Copy code">
          Copy
        </button>
      </div>
      <pre>
        <code>{highlightToReact(code, language)}</code>
      </pre>
    </div>
  );
}

/**
 * NodeView for code blocks. A `mermaid` code block renders as a diagram while
 * the editor is read-only (non-editable); in edit mode — and for every other
 * language — it falls back to the default editable `<pre><code>` so the source
 * stays editable. Mirrors the read-only render path's mermaid behavior, so the
 * description looks the same whether it's displayed via Milkdown or react-markdown.
 *
 * Non-mermaid read-only blocks render highlighted code with a Copy button header.
 * Non-mermaid edit-mode blocks render an editable `<pre><code>` with a language
 * selector header (the `<code>` remains the contentDOM so editing is unchanged).
 */
export function createCodeBlockNodeView(): NodeViewConstructor {
  return (node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) => {
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

    // Read-only, non-mermaid: render highlighted code (presentation only).
    if (!view.editable) {
      const dom = document.createElement("div");
      dom.setAttribute("data-milkdown-codeblock", "");
      const root = createRoot(dom);
      const lang = node.attrs.language as string | undefined;
      root.render(<ReadOnlyCodeBlock code={node.textContent} language={lang} />);
      return {
        dom,
        ignoreMutation: () => true,
        update(updated: ProseMirrorNode) {
          if (updated.type !== node.type) return false;
          if ((updated.attrs.language as string | undefined) === "mermaid") return false;
          const l = updated.attrs.language as string | undefined;
          root.render(<ReadOnlyCodeBlock code={updated.textContent} language={l} />);
          return true;
        },
        destroy() {
          root.unmount();
        },
      };
    }

    // Edit mode (non-mermaid): editable <pre><code> with a header + language
    // selector. The <code> stays the contentDOM so editing is unchanged. Do NOT
    // set contenteditable on the wrapper or the <pre>/<code> — ProseMirror owns
    // the contentDOM's editability. Only the header is marked non-editable;
    // manually nesting contenteditable=true inside =false corrupts PM's
    // selection/DOM handling (backspace/Enter break, clicks go read-only).
    const wrapper = document.createElement("div");
    wrapper.className = "md-codeblock md-codeblock-edit";

    const header = document.createElement("div");
    header.className = "md-codeblock-header";
    header.setAttribute("contenteditable", "false");
    const select = document.createElement("select");
    select.className = "md-codeblock-select";
    const language = node.attrs.language as string | undefined;
    for (const opt of CODE_LANGUAGES) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      if ((language ?? "") === opt.value) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener("change", () => {
      const pos = typeof getPos === "function" ? getPos() : null;
      if (pos == null) return;
      const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        language: select.value || null,
      });
      view.dispatch(tr);
    });
    header.appendChild(select);

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    if (language) code.setAttribute("data-language", language);
    pre.appendChild(code);

    wrapper.appendChild(header);
    wrapper.appendChild(pre);
    return {
      dom: wrapper,
      contentDOM: code,
      // Keep the node view alive while it stays a code block so ProseMirror
      // patches the code content in place. Without `update`, PM recreates the
      // view on every keystroke, tearing down the editable <code> and breaking
      // typing/Enter inside the block.
      update(updated: ProseMirrorNode) {
        return updated.type === node.type;
      },
    };
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
