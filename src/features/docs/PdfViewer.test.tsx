// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const pdf = vi.hoisted(() => ({ getPage: vi.fn() }));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({ numPages: 1, getPage: pdf.getPage }),
    destroy: () => Promise.resolve(),
  }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.mjs" }));

import PdfViewer from "./PdfViewer";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

describe("PdfViewer", () => {
  it("reports a PDF whose first page can't be read instead of hanging on 'Opening'", async () => {
    pdf.getPage.mockRejectedValue(new Error("bad xref"));
    render(<PdfViewer data={new ArrayBuffer(4)} />);
    expect(await screen.findByText(/this pdf couldn't be opened/i)).toBeTruthy();
  });
});
