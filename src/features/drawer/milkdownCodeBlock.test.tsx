// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const renderSpy = vi.fn();
const unmountSpy = vi.fn();
vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: renderSpy, unmount: unmountSpy }),
}));
vi.mock("@milkdown/kit/utils", () => ({
  $view: (_node: unknown, factory: unknown) => ({ factory }),
}));
vi.mock("@milkdown/kit/preset/commonmark", () => ({ codeBlockSchema: { node: {} } }));

import { createCodeBlockNodeView } from "./milkdownCodeBlock";

const nodeType = {};
function fakeNode(language: string, text: string) {
  return { attrs: { language }, textContent: text, type: nodeType } as never;
}
const nodeView = createCodeBlockNodeView();
// The NodeViewConstructor takes (node, view, getPos, decorations, innerDecorations);
// only node + view matter here, so pad the rest.
const construct = (node: never, view: never) =>
  nodeView(node, view, () => 0, [], {} as never);

afterEach(() => {
  renderSpy.mockReset();
  unmountSpy.mockReset();
});

describe("createCodeBlockNodeView", () => {
  it("renders a mermaid diagram (no contentDOM) when the editor is read-only", () => {
    const view = construct(fakeNode("mermaid", "graph TD; A-->B"), { editable: false } as never);
    expect((view.dom as HTMLElement).getAttribute("data-milkdown-mermaid")).toBe("");
    expect(view.contentDOM).toBeUndefined();
    const rendered = renderSpy.mock.calls[0][0] as { props: { code: string } };
    expect(rendered.props.code).toBe("graph TD; A-->B");
  });

  it("keeps an editable <pre><code> for mermaid while editing (source is editable)", () => {
    const view = construct(fakeNode("mermaid", "graph TD; A-->B"), { editable: true } as never);
    expect((view.dom as HTMLElement).tagName).toBe("PRE");
    expect((view.contentDOM as HTMLElement).tagName).toBe("CODE");
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("keeps an editable <pre><code> for non-mermaid code even when read-only", () => {
    const view = construct(fakeNode("ts", "const x = 1;"), { editable: false } as never);
    expect((view.dom as HTMLElement).tagName).toBe("PRE");
    expect((view.contentDOM as HTMLElement).tagName).toBe("CODE");
    expect((view.contentDOM as HTMLElement).getAttribute("data-language")).toBe("ts");
    expect(renderSpy).not.toHaveBeenCalled();
  });
});
