// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/features/drawer/MermaidDiagram", () => ({
  MermaidDiagram: ({ code }: { code: string }) => <div data-testid="diagram">{code}</div>,
}));

import { DocViewer } from "./DocViewer";

afterEach(cleanup);

describe("DocViewer", () => {
  it("draws a mermaid code block as a diagram instead of raw source", async () => {
    render(<DocViewer markdown={"# Flow\n\n```mermaid\ngraph TD\n  A-->B\n```\n"} />);
    const diagram = await waitFor(() => screen.getByTestId("diagram"));
    expect(diagram.textContent).toBe("graph TD\n  A-->B");
  });
});
