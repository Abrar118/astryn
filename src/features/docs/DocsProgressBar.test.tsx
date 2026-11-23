// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DocsProgressBar, progressLabel } from "./DocsProgressBar";

afterEach(cleanup);

describe("DocsProgressBar", () => {
  it("shows files read with a percentage", () => {
    render(<DocsProgressBar progress={{ phase: "reading", done: 40, total: 160 }} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
    expect(screen.getByText("Reading files: 40 of 160 files · 25%")).toBeTruthy();
  });

  it("describes the meaning-vector phase in sections", () => {
    expect(progressLabel({ phase: "embedding", done: 3, total: 4 })).toBe(
      "Preparing meaning-based search: 3 of 4 sections · 75%",
    );
  });

  it("has no percentage until the total is known, and renders nothing when idle", () => {
    const { rerender } = render(<DocsProgressBar progress={{ phase: "reading", done: 0, total: 0 }} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBeNull();
    expect(screen.getByText("Reading files…")).toBeTruthy();
    rerender(<DocsProgressBar progress={null} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
