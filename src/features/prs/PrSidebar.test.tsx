// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GithubPr } from "@/lib/commands";

const repositoryQuery = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries", () => ({
  useGithubRepositories: repositoryQuery,
}));

import { PrSidebar } from "./PrSidebar";

afterEach(cleanup);
beforeEach(() => {
  repositoryQuery.mockReturnValue({
    data: {
      repositories: ["Abrar/personal", "GAM-Health/platform"],
      truncated: false,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});

const row = {
  id: "Acme/Web#1",
  bucket: "mine",
  repo: "Acme/Web",
  number: 1,
  title: "PR",
} as GithubPr;

describe("PrSidebar", () => {
  it("lists owned and organization repositories beyond cached PR rows", () => {
    render(
      <PrSidebar
        prs={[]}
        favorites={[]}
        activeScope="mine"
        onSelect={vi.fn()}
        onFavoriteChange={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /add favorite repository/i }),
    );

    expect(
      screen.getByRole("button", { name: "Abrar/personal" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "GAM-Health/platform" }),
    ).toBeInTheDocument();
  });

  it("closes the repository picker when pointer focus moves outside it", () => {
    render(
      <PrSidebar
        prs={[row]}
        favorites={[]}
        activeScope="mine"
        onSelect={vi.fn()}
        onFavoriteChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: /add favorite repository/i,
    });
    fireEvent.click(trigger);
    expect(screen.getByRole("searchbox")).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the repository picker with Escape and restores trigger focus", () => {
    render(
      <PrSidebar
        prs={[row]}
        favorites={[]}
        activeScope="mine"
        onSelect={vi.fn()}
        onFavoriteChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: /add favorite repository/i,
    });
    fireEvent.click(trigger);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("keeps cached repositories available and offers retry after a catalog error", () => {
    const refetch = vi.fn();
    repositoryQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    render(
      <PrSidebar
        prs={[row]}
        favorites={[]}
        activeScope="mine"
        onSelect={vi.fn()}
        onFavoriteChange={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /add favorite repository/i }),
    );

    expect(screen.getByRole("button", { name: "Acme/Web" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /couldn't load all repositories/i,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry repositories/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("adds a known repository from the searchable picker", () => {
    const onFavoriteChange = vi.fn();
    render(
      <PrSidebar
        prs={[row]}
        favorites={[]}
        activeScope="mine"
        onSelect={vi.fn()}
        onFavoriteChange={onFavoriteChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add favorite repository/i }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Acme/Web" }));
    expect(onFavoriteChange).toHaveBeenCalledWith("Acme/Web", true);
  });

  it("offers an explicit unfavorite action", () => {
    const onFavoriteChange = vi.fn();
    render(
      <PrSidebar
        prs={[{ ...row, bucket: "repo:acme/web" }]}
        favorites={["Acme/Web"]}
        activeScope="repo:acme/web"
        onSelect={vi.fn()}
        onFavoriteChange={onFavoriteChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Unfavorite Acme/Web" }));
    expect(onFavoriteChange).toHaveBeenCalledWith("Acme/Web", false);
  });

  it("marks a stale favorite and offers a scoped retry", () => {
    const onRetry = vi.fn();
    render(
      <PrSidebar
        prs={[{ ...row, bucket: "repo:acme/web" }]}
        favorites={["Acme/Web"]}
        activeScope="mine"
        staleScopes={new Set(["repo:acme/web"])}
        onSelect={vi.fn()}
        onFavoriteChange={vi.fn()}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry Acme/Web" }));
    expect(onRetry).toHaveBeenCalled();
  });
});
