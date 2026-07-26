import { describe, expect, it } from "vitest";
import { parseUnifiedPatch } from "./prDiffDisplay";

describe("parseUnifiedPatch", () => {
  it("classifies unified rows and advances old and new line numbers", () => {
    const rows = parseUnifiedPatch(
      [
        "@@ -10,3 +20,4 @@ export function review() {",
        " context",
        "-old value",
        "+new value",
        "+extra value",
        "\\ No newline at end of file",
      ].join("\n"),
    );

    expect(rows).toEqual([
      {
        key: "0-hunk",
        kind: "hunk",
        oldLine: null,
        newLine: null,
        text: "@@ -10,3 +20,4 @@ export function review() {",
      },
      {
        key: "1-context",
        kind: "context",
        oldLine: 10,
        newLine: 20,
        text: "context",
      },
      {
        key: "2-deletion",
        kind: "deletion",
        oldLine: 11,
        newLine: null,
        text: "old value",
      },
      {
        key: "3-addition",
        kind: "addition",
        oldLine: null,
        newLine: 21,
        text: "new value",
      },
      {
        key: "4-addition",
        kind: "addition",
        oldLine: null,
        newLine: 22,
        text: "extra value",
      },
      {
        key: "5-metadata",
        kind: "metadata",
        oldLine: null,
        newLine: null,
        text: "\\ No newline at end of file",
      },
    ]);
  });

  it("resets counters at every hunk and supports omitted counts", () => {
    const rows = parseUnifiedPatch(
      ["@@ -1 +1 @@", "-a", "+b", "@@ -40,2 +50,2 @@", " c"].join("\n"),
    );

    expect(rows[1]).toMatchObject({ oldLine: 1, newLine: null });
    expect(rows[2]).toMatchObject({ oldLine: null, newLine: 1 });
    expect(rows[4]).toMatchObject({ oldLine: 40, newLine: 50 });
  });

  it("returns no rows for a blank patch", () => {
    expect(parseUnifiedPatch("")).toEqual([]);
  });
});
