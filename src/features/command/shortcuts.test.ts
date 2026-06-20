import { describe, expect, it } from "vitest";
import { shouldOpenCreateShortcut } from "./shortcuts";

describe("shouldOpenCreateShortcut", () => {
  it("opens only for an unmodified c outside editable fields and overlays", () => {
    expect(shouldOpenCreateShortcut({ key: "c", editable: false, overlayOpen: false })).toBe(true);
    expect(shouldOpenCreateShortcut({ key: "c", editable: true, overlayOpen: false })).toBe(false);
    expect(shouldOpenCreateShortcut({ key: "c", editable: false, overlayOpen: true })).toBe(false);
    expect(shouldOpenCreateShortcut({ key: "c", editable: false, overlayOpen: false, metaKey: true })).toBe(false);
  });
});
