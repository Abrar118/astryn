import { describe, expect, it } from "vitest";
import { LABEL_COLORS, pickLabelColor } from "./labelColors";
import type { Label } from "@/lib/commands";

const lbl = (color: string): Label => ({ id: color, name: "x", color });

describe("pickLabelColor", () => {
  it("returns the first palette color when none are used", () => {
    expect(pickLabelColor([])).toBe(LABEL_COLORS[0]);
  });
  it("returns a color not already used when possible", () => {
    const used = LABEL_COLORS.slice(0, 3).map(lbl);
    expect(LABEL_COLORS.slice(0, 3)).not.toContain(pickLabelColor(used));
  });
});
