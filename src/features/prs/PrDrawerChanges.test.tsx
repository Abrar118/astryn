// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type {
  GithubPr,
  GithubPrDetail,
  GithubPrDiff,
} from "@/lib/commands";

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

const detail = {
  changedFiles: 2,
  additions: 40,
  deletions: 12,
  commitCount: 7,
} as GithubPrDetail;

const diff = {
  repo: seed.repo,
  number: seed.number,
  totalFiles: 2,
  truncated: false,
  files: [
    {
      path: "src/review.ts",
      previousPath: null,
      changeType: "modified",
      additions: 2,
      deletions: 1,
      changes: 3,
      patch: [
        "@@ -10,2 +10,3 @@ export function review() {",
        " context",
        "-old value",
        "+new value",
        "+extra value",
      ].join("\n"),
      blobUrl: "https://github.com/acme/web/blob/head/src/review.ts",
    },
    {
      path: "assets/logo.png",
      previousPath: null,
      changeType: "modified",
      additions: 0,
      deletions: 0,
      changes: 0,
      patch: null,
      blobUrl: "https://github.com/acme/web/blob/head/assets/logo.png",
    },
  ],
} satisfies GithubPrDiff;

describe("PrDrawerChanges", () => {
  it("renders the Linear files toolbar and full unified patch rows", () => {
    render(<PrDrawerChanges seed={seed} detail={detail} diff={diff} />);

    expect(screen.getByText("Files 2")).toBeInTheDocument();
    expect(screen.getByText("Commits 7")).toBeInTheDocument();
    const table = screen.getByRole("table", {
      name: "Diff for src/review.ts",
    });
    expect(within(table).getByText(/@@ -10,2 \+10,3 @@/)).toBeInTheDocument();
    expect(within(table).getByText("old value")).toBeInTheDocument();
    expect(within(table).getByText("new value")).toBeInTheDocument();
    expect(within(table).getAllByText("10")).toHaveLength(2);
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
  });

  it("shows a file-level fallback when GitHub omits a text patch", () => {
    render(<PrDrawerChanges seed={seed} detail={detail} diff={diff} />);

    expect(
      screen.getByText(
        "GitHub did not provide a text patch for this file.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open assets/logo.png on GitHub",
      }),
    );
    expect(openUrl).toHaveBeenCalledWith(
      "https://github.com/acme/web/blob/head/assets/logo.png",
    );
  });

  it("keeps GitHub fallback and retry actions in loading and error states", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <PrDrawerChanges
        seed={seed}
        detail={detail}
        loading
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /loading file patches/i,
    );

    rerender(
      <PrDrawerChanges
        seed={seed}
        detail={detail}
        error
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /couldn't load the full diff/i,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: /open full diff on github/i }),
    );
    expect(openUrl).toHaveBeenCalledWith(
      "https://github.com/acme/web/pull/42/files",
    );
  });

  it("announces a bounded response", () => {
    render(
      <PrDrawerChanges
        seed={seed}
        detail={detail}
        diff={{ ...diff, truncated: true }}
      />,
    );
    expect(
      screen.getByText(/showing the first 2 changed files/i),
    ).toBeInTheDocument();
  });
});
