// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DescriptionEditor, EditorErrorBoundary, ReadOnlyDescription } from "./DescriptionEditor";

// Mock @milkdown/react so jsdom never tries to mount ProseMirror
vi.mock("@milkdown/react", () => ({
  MilkdownProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Milkdown: () => <div contentEditable="true" role="textbox" aria-label="Issue description" />,
  useEditor: () => ({ loading: false, get: () => undefined }),
}));

// Mock the kit packages to avoid ESM issues in test
vi.mock("@milkdown/kit/core", () => ({
  Editor: { make: () => ({ config: () => ({}), use: () => ({}) }) },
  defaultValueCtx: "defaultValueCtx",
  rootCtx: "rootCtx",
  editorViewOptionsCtx: "editorViewOptionsCtx",
}));

vi.mock("@milkdown/kit/plugin/listener", () => ({
  listener: {},
  listenerCtx: "listenerCtx",
}));

vi.mock("./milkdownEditor", () => ({
  descriptionPlugins: [],
  applyDescriptionConfig: vi.fn(),
}));

vi.mock("./milkdownMenus", () => ({
  configureDescriptionSlash: vi.fn(),
  configureDescriptionTooltip: vi.fn(),
  descriptionSlash: [],
  descriptionTooltip: [],
}));

vi.mock("./milkdownMention", () => ({
  descriptionMentionPlugin: vi.fn(() => []),
  issueMentionFromUrl: vi.fn(() => null),
}));

afterEach(cleanup);

describe("DescriptionEditor", () => {
  it("renders read-only Markdown by default (rich text, no editor textbox)", async () => {
    render(
      <DescriptionEditor
        markdown={"## Plan\n\n**Ship it**"}
        editable
        onSave={vi.fn()}
        onOpenLink={vi.fn()}
      />,
    );
    expect(await screen.findByRole("heading", { level: 2, name: "Plan" })).toBeTruthy();
    expect(screen.getByText("Ship it").tagName).toBe("STRONG");
    // No editor textbox in read-only mode
    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
  });

  it("double-click when editable=true shows the Milkdown editor", async () => {
    render(
      <DescriptionEditor
        markdown={"## Plan\n\n**Ship it**"}
        editable
        onSave={vi.fn()}
        onOpenLink={vi.fn()}
      />,
    );
    const heading = await screen.findByRole("heading", { level: 2, name: "Plan" });
    fireEvent.doubleClick(heading);
    expect(document.querySelector('[contenteditable="true"]')).not.toBeNull();
  });

  it("read-only mode: double-click does NOT show contenteditable", () => {
    render(
      <DescriptionEditor
        markdown="Cached"
        editable={false}
        onSave={vi.fn()}
        onOpenLink={vi.fn()}
      />,
    );
    fireEvent.doubleClick(screen.getByText("Cached"));
    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
  });
});

describe("EditorErrorBoundary", () => {
  it("shows the fallback when the editor subtree throws", () => {
    const Boom = () => {
      throw new Error("contentMatchAt on a node with invalid content");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <EditorErrorBoundary fallback={<div>read-only fallback</div>}>
        <Boom />
      </EditorErrorBoundary>,
    );
    expect(screen.getByText("read-only fallback")).toBeTruthy();
    spy.mockRestore();
  });
});

describe("ReadOnlyDescription", () => {
  it("renders markdown as rich HTML", () => {
    render(
      <ReadOnlyDescription markdown={"## Title\n\nbody **bold**"} onOpenLink={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Title" })).toBeTruthy();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });
});
