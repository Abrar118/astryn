// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, act, fireEvent } from "@testing-library/react";
import { IssueMentionPill } from "./IssueMentionPill";
import type { MentionTarget } from "../markdownComponents";

// Prevent createPortal from rendering outside jsdom root
vi.mock("react-dom", async (importOriginal) => {
  const real = await importOriginal<typeof import("react-dom")>();
  return {
    ...real,
    createPortal: (node: React.ReactNode) => node,
  };
});

const mockTarget: MentionTarget = {
  identifier: "PSY-55",
  title: "Fix memory leak in worker thread",
  stateType: "started",
  stateColor: "#6366f1",
  stateName: "In Progress",
  projectName: "Core Platform",
  priority: 2,
  assigneeName: "Alice Johnson",
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("IssueMentionPill", () => {
  it("renders the identifier and title inline in the pill", () => {
    render(
      <IssueMentionPill
        target={mockTarget}
        href="https://linear.app/gam/issue/PSY-55/fix"
        onActivate={vi.fn()}
      />,
    );
    const pill = screen.getByRole("button");
    expect(pill.textContent).toContain("PSY-55");
    expect(pill.textContent).toContain("Fix memory leak in worker thread");
  });

  it("calls onActivate with the href when clicked", () => {
    const onActivate = vi.fn();
    render(
      <IssueMentionPill
        target={mockTarget}
        href="https://linear.app/gam/issue/PSY-55/fix"
        onActivate={onActivate}
      />,
    );
    screen.getByRole("button").click();
    expect(onActivate).toHaveBeenCalledWith("https://linear.app/gam/issue/PSY-55/fix");
  });

  it("shows the hover card after mouseenter delay with stateName, projectName, assigneeName", async () => {
    vi.useFakeTimers();
    render(
      <IssueMentionPill
        target={mockTarget}
        href="https://linear.app/gam/issue/PSY-55/fix"
        onActivate={vi.fn()}
      />,
    );
    const pill = screen.getByRole("button");

    fireEvent.mouseEnter(pill);
    // Card should not be visible yet (150ms delay)
    expect(screen.queryByRole("tooltip")).toBeNull();

    // Advance timers past the 150ms delay
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    const card = screen.getByRole("tooltip");
    expect(card.textContent).toContain("In Progress");
    expect(card.textContent).toContain("Core Platform");
    expect(card.textContent).toContain("Alice Johnson");
  });

  it("hides the hover card on mouseleave", async () => {
    vi.useFakeTimers();
    render(
      <IssueMentionPill
        target={mockTarget}
        href="https://linear.app/gam/issue/PSY-55/fix"
        onActivate={vi.fn()}
      />,
    );
    const pill = screen.getByRole("button");

    fireEvent.mouseEnter(pill);
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.mouseLeave(pill);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows the hover card on focus and hides on blur", async () => {
    vi.useFakeTimers();
    render(
      <IssueMentionPill
        target={mockTarget}
        href="https://linear.app/gam/issue/PSY-55/fix"
        onActivate={vi.fn()}
      />,
    );
    const pill = screen.getByRole("button");

    fireEvent.focus(pill);
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.blur(pill);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("renders without assignee when assigneeName is null", async () => {
    vi.useFakeTimers();
    const noAssignee: MentionTarget = { ...mockTarget, assigneeName: null };
    render(
      <IssueMentionPill
        target={noAssignee}
        href="https://linear.app/gam/issue/PSY-55/fix"
        onActivate={vi.fn()}
      />,
    );
    const pill = screen.getByRole("button");
    fireEvent.mouseEnter(pill);
    await act(async () => { vi.advanceTimersByTime(200); });
    const card = screen.getByRole("tooltip");
    expect(card.textContent).not.toContain("Alice Johnson");
  });

  it("renders without project when projectName is null", async () => {
    vi.useFakeTimers();
    const noProject: MentionTarget = { ...mockTarget, projectName: null };
    render(
      <IssueMentionPill
        target={noProject}
        href="https://linear.app/gam/issue/PSY-55/fix"
        onActivate={vi.fn()}
      />,
    );
    const pill = screen.getByRole("button");
    fireEvent.mouseEnter(pill);
    await act(async () => { vi.advanceTimersByTime(200); });
    const card = screen.getByRole("tooltip");
    expect(card.textContent).not.toContain("Core Platform");
  });
});
