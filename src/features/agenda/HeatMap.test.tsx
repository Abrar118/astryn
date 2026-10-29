// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HeatMap } from "./HeatMap";
import type { HeatWeek } from "./agendaStats";

const week = (offset: number, start: string, counts: number[]): HeatWeek => ({
  offset,
  cells: counts.map((count, i) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), count, offset };
  }),
});

const WEEKS = [
  week(-1, "2026-10-18", [0, 1, 0, 0, 2, 0, 0]),
  week(0, "2026-10-25", [0, 0, 0, 0, 1, 0, 0]),
];

afterEach(cleanup);

describe("HeatMap", () => {
  it("keeps only the selected week in the tab order and names each week by its due count", () => {
    render(<HeatMap weeks={WEEKS} currentOffset={0} onSelectWeek={() => {}} />);
    const last = screen.getByRole("button", { name: "Week of Oct 18: 3 due" });
    const current = screen.getByRole("button", { name: "Week of Oct 25: 1 due" });
    expect(current.getAttribute("tabindex")).toBe("0");
    expect(current.getAttribute("aria-pressed")).toBe("true");
    expect(last.getAttribute("tabindex")).toBe("-1");
    expect(last.getAttribute("aria-pressed")).toBe("false");
  });

  it("jumps to a week when its column is clicked", () => {
    const onSelectWeek = vi.fn();
    render(<HeatMap weeks={WEEKS} currentOffset={0} onSelectWeek={onSelectWeek} />);
    fireEvent.click(screen.getByRole("button", { name: "Week of Oct 18: 3 due" }));
    expect(onSelectWeek).toHaveBeenCalledWith(-1);
  });
});
