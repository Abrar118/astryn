// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GithubPr } from "@/lib/commands";

const openUrl = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("goey-toast", () => ({ gooeyToast: toast }));

import { PrContextMenu } from "./PrContextMenu";

const pr = {
  id: "acme/web#42",
  bucket: "mine",
  repo: "Acme/Web",
  number: 42,
  title: "Make review faster",
  url: "https://github.com/acme/web/pull/42",
} as GithubPr;

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup(favorite = false) {
  const onFavoriteChange = vi.fn();
  const onClose = vi.fn();
  render(
    <PrContextMenu
      pr={pr}
      favorite={favorite}
      x={80}
      y={100}
      onFavoriteChange={onFavoriteChange}
      onClose={onClose}
    />,
  );
  return { onFavoriteChange, onClose };
}

describe("PrContextMenu", () => {
  it("copies the pull request link", async () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("https://github.com/acme/web/pull/42"),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("copies the pull request title", async () => {
    setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy PR title" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Make review faster"));
  });

  it("opens the pull request externally", async () => {
    setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "Open PR" }));
    await waitFor(() =>
      expect(openUrl).toHaveBeenCalledWith("https://github.com/acme/web/pull/42"),
    );
  });

  it("toggles the repository favorite", () => {
    const { onFavoriteChange } = setup(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Unfavorite repository" }));
    expect(onFavoriteChange).toHaveBeenCalledWith("Acme/Web", false);
  });

  it("reports a clipboard failure without an unhandled rejection", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't copy PR link"),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("supports standard menu keyboard navigation and closes on Tab", () => {
    const { onClose } = setup();
    const menu = screen.getByRole("menu");
    const copyLink = screen.getByRole("menuitem", { name: "Copy link" });
    const copyTitle = screen.getByRole("menuitem", { name: "Copy PR title" });
    const favorite = screen.getByRole("menuitem", {
      name: "Favorite repository",
    });
    expect(copyLink).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(copyTitle).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(favorite).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(copyLink).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Tab" });
    expect(onClose).toHaveBeenCalled();
  });
});
