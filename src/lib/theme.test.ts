import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { DEFAULT_THEME, parseTheme, resolveTheme, THEMES } from "./theme";

describe("parseTheme", () => {
  it("accepts a fixed theme or auto with a dark/light pair", () => {
    expect(parseTheme('{"mode":"stone","dark":"charcoal","light":"stone"}')).toEqual({
      mode: "stone",
      dark: "charcoal",
      light: "stone",
    });
    expect(parseTheme('{"mode":"auto","dark":"graphite","light":"paper"}').mode).toBe("auto");
  });

  it("falls back per field on unknown ids or a theme in the wrong scheme slot", () => {
    expect(parseTheme('{"mode":"neon","dark":"paper","light":"charcoal"}')).toEqual(DEFAULT_THEME);
    for (const raw of [null, "nope", "[1]", '"x"']) expect(parseTheme(raw)).toEqual(DEFAULT_THEME);
  });
});

describe("resolveTheme", () => {
  it("uses the fixed theme regardless of the OS", () => {
    expect(resolveTheme({ ...DEFAULT_THEME, mode: "paper" }, true)).toBe("paper");
  });

  it("follows the OS in auto mode", () => {
    const pref = { mode: "auto", dark: "charcoal", light: "stone" } as const;
    expect(resolveTheme(pref, true)).toBe("charcoal");
    expect(resolveTheme(pref, false)).toBe("stone");
  });
});

describe("themes.css", () => {
  it("defines every theme with the same token set", () => {
    const css = readFileSync("src/styles/themes.css", "utf8");
    const tokenSets = THEMES.map(({ id }) => {
      const block = css.match(new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      return [...block.matchAll(/--([\w-]+):/g)].map((m) => m[1]).sort();
    });
    expect(tokenSets[0]).toContain("success");
    for (const set of tokenSets) expect(set).toEqual(tokenSets[0]);
  });
});
