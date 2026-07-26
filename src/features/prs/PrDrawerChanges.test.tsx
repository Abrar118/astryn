// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GithubPr, GithubPrDetail } from "@/lib/commands";

const openUrl = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("goey-toast", () => ({
  gooeyToast: { error: vi.fn(), success: vi.fn() },
}));

import { PrDrawerChanges } from "./PrDrawerChanges";

afterEach(cleanup);

const seed = {
  repo: "Acme/Web",
  number: 42,
  title: "Make review faster",
  url: "https://github.com/acme/web/pull/42",
  additions: 40,
  deletions: 12,
  changedFiles: 2,
} as GithubPr;

describe("PrDrawerChanges", () => {
  it("renders file-level changes and a truncation note", () => {
    const detail = {
      files: [
        {
          path: "src/review.ts",
          changeType: "modified",
          additions: 32,
          deletions: 10,
        },
        {
          path: "src/new.ts",
          changeType: "added",
          additions: 8,
          deletions: 2,
        },
      ],
      truncated: { files: true },
    } as GithubPrDetail;
    render(<PrDrawerChanges seed={seed} detail={detail} />);
    expect(screen.getByText("src/review.ts")).toBeInTheDocument();
    expect(screen.getByText("+32")).toBeInTheDocument();
    expect(screen.getByText("−10")).toBeInTheDocument();
    expect(screen.getByText(/showing the first 2 changed files/i)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /open full diff on github/i }),
    );
    expect(openUrl).toHaveBeenCalledWith(
      "https://github.com/acme/web/pull/42/files",
    );
  });

  it("keeps cached totals visible before file details load", () => {
    render(<PrDrawerChanges seed={seed} detail={undefined} />);
    expect(screen.getByText(/2 changed files/i)).toBeInTheDocument();
    expect(screen.getByText(/file details load with live data/i)).toBeInTheDocument();
  });
});
