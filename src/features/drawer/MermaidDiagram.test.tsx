// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MermaidDiagram } from "./MermaidDiagram";

const renderMock = vi.fn();
const initializeMock = vi.fn();
vi.mock("mermaid", () => ({
  default: {
    initialize: (...args: unknown[]) => initializeMock(...args),
    render: (...args: unknown[]) => renderMock(...args),
  },
}));

afterEach(() => {
  cleanup();
  renderMock.mockReset();
  initializeMock.mockReset();
});

describe("MermaidDiagram", () => {
  it("renders the SVG produced by mermaid", async () => {
    renderMock.mockResolvedValue({ svg: "<svg data-testid='diagram'><g/></svg>" });
    render(<MermaidDiagram code={"graph TD; A-->B"} />);
    await waitFor(() => expect(screen.getByTestId("diagram")).toBeTruthy());
    expect(renderMock).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-/), "graph TD; A-->B");
  });

  it("initializes mermaid with strict security and a dark theme", async () => {
    renderMock.mockResolvedValue({ svg: "<svg data-testid='diagram'/>" });
    render(<MermaidDiagram code={"graph TD; A-->B"} />);
    await waitFor(() => expect(initializeMock).toHaveBeenCalled());
    expect(initializeMock).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "strict", theme: "dark" }),
    );
  });

  it("falls back to the raw source in a code block when rendering throws", async () => {
    renderMock.mockRejectedValue(new Error("Parse error on line 1"));
    render(<MermaidDiagram code={"not valid mermaid"} />);
    await waitFor(() =>
      expect(document.querySelector("pre code")?.textContent).toBe("not valid mermaid"),
    );
  });
});
