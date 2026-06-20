import { describe, expect, it } from "vitest";
import { classifyImageSource } from "./linearImages";

describe("classifyImageSource", () => {
  it("proxies only Linear uploads and permits safe raster data URLs", () => {
    expect(classifyImageSource("https://uploads.linear.app/a/b?signature=x")).toBe("proxy");
    expect(classifyImageSource("data:image/png;base64,cG5n")).toBe("direct");
    expect(classifyImageSource("data:image/svg+xml;base64,PHN2Zy8+")).toBe("blocked");
    expect(classifyImageSource("https://uploads.linear.app.evil.test/a")).toBe("blocked");
    expect(classifyImageSource("https://example.com/image.png")).toBe("blocked");
    expect(classifyImageSource("javascript:alert(1)")).toBe("blocked");
  });
});
