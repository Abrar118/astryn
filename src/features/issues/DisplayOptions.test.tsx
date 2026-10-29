// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DisplayOptions } from "./DisplayOptions";
import { DEFAULT_DISPLAY } from "./viewConfig";

afterEach(cleanup);

describe("DisplayOptions", () => {
  const renderOptions = (onToggleDisplay = vi.fn()) =>
    render(
      <DisplayOptions
        ordering="status"
        onOrdering={vi.fn()}
        completed="all"
        onCompleted={vi.fn()}
        display={DEFAULT_DISPLAY}
        onToggleDisplay={onToggleDisplay}
      />,
    );

  it("reports each display property as an on/off switch", () => {
    renderOptions();
    expect(screen.getByRole("switch", { name: "due date" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch", { name: "estimate" }).getAttribute("aria-checked")).toBe("false");
  });

  it("toggles the property it names", () => {
    const onToggle = vi.fn();
    renderOptions(onToggle);
    fireEvent.click(screen.getByRole("switch", { name: "pull requests" }));
    expect(onToggle).toHaveBeenCalledWith("pullRequests");
  });
});
