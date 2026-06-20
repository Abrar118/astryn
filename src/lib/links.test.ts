import { describe, expect, it } from "vitest";
import { safeExternalUrl } from "./links";

describe("safeExternalUrl", () => {
  it("allows web URLs and rejects executable or malformed schemes", () => {
    expect(safeExternalUrl("https://linear.app/x")).toBe("https://linear.app/x");
    expect(safeExternalUrl("mailto:test@example.com")).toBe("mailto:test@example.com");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("file:///etc/passwd")).toBeNull();
  });
});
