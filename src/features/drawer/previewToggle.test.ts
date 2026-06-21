import { describe, it, expect } from "vitest";
import { togglePreviewLabel } from "./previewToggle";

describe("togglePreviewLabel", () => {
  it("offers 'Display as link' for a preview", () => {
    expect(togglePreviewLabel("preview")).toBe("Display as link");
  });
  it("offers 'Display as preview' for a link", () => {
    expect(togglePreviewLabel("link")).toBe("Display as preview");
  });
  it("offers nothing otherwise", () => {
    expect(togglePreviewLabel("none")).toBeNull();
  });
});
