// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DescriptionEditor } from "./DescriptionEditor";

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
