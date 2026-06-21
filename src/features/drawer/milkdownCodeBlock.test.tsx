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

  it("keeps mermaid source editable in an edit-mode wrapper while editing", () => {
    const view = construct(fakeNode("mermaid", "graph TD; A-->B"), { editable: true } as never);
    expect((view.dom as HTMLElement).tagName).toBe("DIV");
    expect((view.dom as HTMLElement).className).toContain("md-codeblock-edit");
    expect((view.contentDOM as HTMLElement).tagName).toBe("CODE");
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("renders highlighted React code (no contentDOM) for non-mermaid code when read-only", () => {
    const view = construct(fakeNode("ts", "const x = 1;"), { editable: false } as never);
    expect((view.dom as HTMLElement).getAttribute("data-milkdown-codeblock")).toBe("");
    expect(view.contentDOM).toBeUndefined();
    expect(renderSpy).toHaveBeenCalled();
    const rendered = renderSpy.mock.calls[0][0] as { props: { code: string; language: string } };
    expect(rendered.props.code).toBe("const x = 1;");
    expect(rendered.props.language).toBe("ts");
  });
});
