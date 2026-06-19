// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DescriptionEditor, EditorErrorBoundary, ReadOnlyDescription } from "./DescriptionEditor";

afterEach(cleanup);

describe("DescriptionEditor", () => {
  it("renders Markdown as inline rich text with no Edit button", async () => {
    render(<DescriptionEditor markdown={"## Plan\n\n**Ship it**"} editable onSave={vi.fn()} onOpenLink={vi.fn()} />);
    expect(await screen.findByRole("heading", { level: 2, name: "Plan" })).toBeTruthy();
    expect(screen.getByText("Ship it").tagName).toBe("STRONG");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("is read-only for cached drawer data", async () => {
    render(<DescriptionEditor markdown="Cached" editable={false} onSave={vi.fn()} onOpenLink={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Issue description" }).getAttribute("contenteditable")).toBe("false");
  });
});

describe("editor crash safety net", () => {
  it("shows the read-only fallback when the editor subtree throws", () => {
    const Boom = () => {
      throw new Error("contentMatchAt on a node with invalid content");
    };
    // Silence the expected React error log for this boundary test.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <EditorErrorBoundary fallback={<div>read-only fallback</div>}>
        <Boom />
      </EditorErrorBoundary>,
    );
    expect(screen.getByText("read-only fallback")).toBeTruthy();
    spy.mockRestore();
  });

  it("the fallback renders the description Markdown read-only", () => {
    render(<ReadOnlyDescription markdown={"## Title\n\nbody **bold**"} onOpenLink={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 2, name: "Title" })).toBeTruthy();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });
});
