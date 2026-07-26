// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PrListPanel } from "./PrListPanel";

afterEach(cleanup);

describe("PrListPanel", () => {
  it("keeps the end of every pull request scope clear of the floating dock", () => {
    render(
      <PrListPanel
        title="My PRs"
        empty="No pull requests."
        prs={[]}
        groupByRepo
      />,
    );

    const section = screen
      .getByRole("heading", { name: "My PRs" })
      .closest("section");
    const scrollSurface = section?.querySelector(".overflow-y-auto");

    expect(scrollSurface).toHaveClass("pb-24");
  });
});
