// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DescriptionEditor, EditorErrorBoundary, ReadOnlyDescription } from "./DescriptionEditor";

// Lets a test make the Milkdown subtree throw on render (simulating markdown
// ProseMirror refuses to parse) so the EditorErrorBoundary fallback engages.
const { milkdownThrows } = vi.hoisted(() => ({ milkdownThrows: { value: false } }));
const { useEditorMock } = vi.hoisted(() => ({ useEditorMock: vi.fn() }));

// Stub DescriptionAutosave so we can assert how the editor drives it without a
// real ProseMirror instance feeding markdownUpdated.
const { autosave } = vi.hoisted(() => ({
  autosave: { flush: vi.fn().mockResolvedValue(undefined), destroy: vi.fn(), update: vi.fn() },
}));
vi.mock("./descriptionAutosave", () => ({
  DescriptionAutosave: class {
    flush = autosave.flush;
    destroy = autosave.destroy;
    update = autosave.update;
    subscribe() {
      return () => {};
    }
  },
}));

// Mock @milkdown/react so jsdom never tries to mount ProseMirror
vi.mock("@milkdown/react", () => ({
  MilkdownProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Milkdown: () => {
    if (milkdownThrows.value) throw new Error("contentMatchAt on a node with invalid content");
    return <div contentEditable="true" role="textbox" aria-label="Issue description" />;
  },
  useEditor: (...args: unknown[]) => {
    useEditorMock(...args);
    return { loading: false, get: () => undefined };
  },
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

afterEach(() => {
  cleanup();
  milkdownThrows.value = false;
  autosave.flush.mockReset().mockResolvedValue(undefined);
  autosave.destroy.mockReset();
  autosave.update.mockReset();
  useEditorMock.mockClear();
});

describe("DescriptionEditor", () => {
  it("renders the description (not editing) and a double-click enters edit mode", () => {
    const { container } = render(
      <DescriptionEditor
        markdown={"## Plan\n\n**Ship it**"}
        editable
        onSave={vi.fn()}
        onOpenLink={vi.fn()}
      />,
    );
    const wrapper = container.querySelector("[data-editing]") as HTMLElement;
    expect(wrapper.getAttribute("data-editing")).toBe("false");
    fireEvent.doubleClick(wrapper);
    expect(
      (container.querySelector("[data-editing]") as HTMLElement).getAttribute("data-editing"),
    ).toBe("true");
  });

  it("does NOT enter edit mode on double-click when editable=false", () => {
    const { container } = render(
      <DescriptionEditor
        markdown="Cached"
        editable={false}
        onSave={vi.fn()}
        onOpenLink={vi.fn()}
      />,
    );
    const wrapper = container.querySelector("[data-editing]") as HTMLElement;
    fireEvent.doubleClick(wrapper);
    expect(
      (container.querySelector("[data-editing]") as HTMLElement).getAttribute("data-editing"),
    ).toBe("false");
  });

  it("rebuilds the display editor when the mention resolver changes", () => {
    const firstResolver = vi.fn(() => undefined);
    const nextResolver = vi.fn(() => undefined);
    const props = {
      markdown: "[PSY-427](https://linear.app/psy/issue/PSY-427/x)",
      editable: true,
      onSave: vi.fn(),
      onOpenLink: vi.fn(),
    };
    const { rerender } = render(
      <DescriptionEditor {...props} resolveMention={firstResolver} />,
    );

    rerender(<DescriptionEditor {...props} resolveMention={nextResolver} />);

    const lastCall = useEditorMock.mock.calls[useEditorMock.mock.calls.length - 1];
    expect(lastCall?.[1]).toEqual([false, nextResolver]);
  });

  it("shows a muted 'No description' affordance when empty", () => {
    render(
      <DescriptionEditor markdown="" editable onSave={vi.fn()} onOpenLink={vi.fn()} />,
    );
    expect(screen.getByText("No description")).toBeTruthy();
    expect(document.querySelector("[data-editing]")).toBeNull();
  });

  it("force-flushes the draft on unmount so a previously-failed save still retries", () => {
    const { container, unmount } = render(
      <DescriptionEditor markdown="hello" editable onSave={vi.fn()} onOpenLink={vi.fn()} />,
    );
    // Enter edit mode so the autosave queue is created.
    fireEvent.doubleClick(container.querySelector("[data-editing]") as HTMLElement);
    unmount();
    // Non-forced flush() would no-op on a latched failure and drop the draft.
    expect(autosave.flush).toHaveBeenCalledWith(true);
  });

  it("recovers a malformed description: the fallback is double-clickable into edit mode", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    milkdownThrows.value = true;
    render(
      <DescriptionEditor markdown="bad markdown" editable onSave={vi.fn()} onOpenLink={vi.fn()} />,
    );
    // The boundary caught the display crash and shows the react-markdown fallback.
    expect(screen.getByText("bad markdown")).toBeTruthy();
    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
    // Content becomes parseable; double-clicking the fallback must reset the
    // boundary and enter the editor (not stay stuck on the fallback).
    milkdownThrows.value = false;
    fireEvent.doubleClick(screen.getByText("bad markdown"));
    expect(document.querySelector('[contenteditable="true"]')).not.toBeNull();
    spy.mockRestore();
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

  it("invokes onError when the editor subtree throws", () => {
    const onError = vi.fn();
    const Boom = () => {
      throw new Error("contentMatchAt on a node with invalid content");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <EditorErrorBoundary fallback={<div>fallback</div>} onError={onError}>
        <Boom />
      </EditorErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
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

  it("renders a Linear-authored plain handle mention with the user's full name", () => {
    render(
      <ReadOnlyDescription
        markdown="@abrar"
        onOpenLink={vi.fn()}
        users={[{ id: "u1", name: "Abrar Mahir Esam", displayName: "abrar" }]}
      />,
    );

    const pill = document.querySelector("[data-mention-pill='user']");
    expect(pill?.textContent).toBe("@Abrar Mahir Esam");
  });
});
