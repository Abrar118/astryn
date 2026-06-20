// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CommentComposer } from "./CommentComposer";

vi.mock("@milkdown/react", () => ({
  MilkdownProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Milkdown: () => <div contentEditable="true" role="textbox" aria-label="composer" />,
  useEditor: () => ({ loading: false, get: () => undefined }),
}));
vi.mock("@milkdown/kit/core", () => ({
  Editor: { make: () => ({ config: () => ({}), use: () => ({}) }) },
  defaultValueCtx: "d", rootCtx: "r", editorViewOptionsCtx: "e", editorViewCtx: "v",
}));
vi.mock("@milkdown/kit/plugin/listener", () => ({ listener: {}, listenerCtx: "l" }));
vi.mock("../milkdownEditor", () => ({ descriptionPlugins: [], applyDescriptionConfig: vi.fn() }));
vi.mock("../milkdownMenus", () => ({ configureDescriptionSlash: vi.fn(), configureDescriptionTooltip: vi.fn() }));

afterEach(cleanup);

describe("CommentComposer", () => {
  it("submits the current markdown via the send button", () => {
    const onSubmit = vi.fn();
    render(
      <CommentComposer variant="pinned" initialMarkdown="hello" submitting={false}
        onSubmit={onSubmit} onOpenLink={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(onSubmit).toHaveBeenCalledWith("hello");
  });

  it("submits on Cmd/Ctrl+Enter", () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <CommentComposer variant="reply" initialMarkdown="reply body" submitting={false}
        onSubmit={onSubmit} onOpenLink={vi.fn()} />,
    );
    fireEvent.keyDown(container.querySelector("[data-comment-composer]")!, { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledWith("reply body");
  });

  it("disables send while submitting", () => {
    render(
      <CommentComposer variant="pinned" initialMarkdown="x" submitting onSubmit={vi.fn()} onOpenLink={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });
});
