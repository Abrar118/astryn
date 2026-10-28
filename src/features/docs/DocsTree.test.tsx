// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ({ openDocTab: vi.fn(), openDocToSide: vi.fn() }) }));

import { DocsTree } from "./DocsTree";
import { buildDocTree } from "./docTree";

afterEach(cleanup);

describe("DocsTree", () => {
  // ClickUp pages are documents that can also have sub-pages.
  const tree = buildDocTree([
    { path: "p1", name: "Overview", kind: "blob", parentPath: "" },
    { path: "p1/p2", name: "Setup", kind: "blob", parentPath: "p1" },
  ]);

  it("opens a parent page and toggles its sub-pages separately", () => {
    const onSelect = vi.fn();
    render(<DocsTree sourceId="clickup:901/abc-1" tree={tree} selectedPath={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(onSelect).toHaveBeenCalledWith("p1");
    expect(screen.queryByRole("button", { name: "Setup" })).toBeNull();

    const toggle = screen.getByRole("button", { name: /expand overview/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Setup" }));
    expect(onSelect).toHaveBeenLastCalledWith("p1/p2");
    expect(screen.getByRole("button", { name: /collapse overview/i })).toBeTruthy();
  });
});
