// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GithubPr } from "@/lib/commands";
import { PrSidebar } from "./PrSidebar";

afterEach(cleanup);

const row = {
  id: "Acme/Web#1",
  bucket: "mine",
  repo: "Acme/Web",
  number: 1,
  title: "PR",
} as GithubPr;

describe("PrSidebar", () => {
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
