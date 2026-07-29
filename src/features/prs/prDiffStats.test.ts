import { describe, expect, it } from "vitest";
import { parseUnifiedPatch } from "./prDiffDisplay";
import {
  churnLabel,
  countChanges,
  rankByChurn,
  totalChurn,
  type PrFileStat,
} from "./prDiffStats";

const stat = (path: string, additions: number, deletions: number): PrFileStat => ({
  path,
  additions,
  deletions,
});

describe("countChanges", () => {
  it("counts additions and deletions in a parsed patch", () => {
    const rows = parseUnifiedPatch(
      ["@@ -1,2 +1,3 @@", " keep", "-gone", "+added", "+also added"].join("\n"),
    );
    expect(countChanges(rows)).toEqual({ additions: 2, deletions: 1 });
  });

  it("returns zeroes for an empty patch", () => {
    expect(countChanges([])).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("rankByChurn", () => {
  it("orders by total churn, largest first", () => {
    const ranked = rankByChurn([stat("a.ts", 1, 1), stat("b.ts", 10, 0)]);
    expect(ranked.map((s) => s.path)).toEqual(["b.ts", "a.ts"]);
  });

  it("breaks ties by path", () => {
    const ranked = rankByChurn([stat("z.ts", 2, 2), stat("a.ts", 3, 1)]);
    expect(ranked.map((s) => s.path)).toEqual(["a.ts", "z.ts"]);
  });

  it("does not mutate the input", () => {
    const input = [stat("a.ts", 1, 1), stat("b.ts", 9, 9)];
    rankByChurn(input);
    expect(input[0].path).toBe("a.ts");
  });
});

describe("churnLabel", () => {
  it("shows both sides when both changed", () => {
    expect(churnLabel(stat("a.ts", 12, 3))).toBe("+12 -3");
  });

  it("omits the side that is zero", () => {
    expect(churnLabel(stat("a.ts", 12, 0))).toBe("+12");
    expect(churnLabel(stat("a.ts", 0, 3))).toBe("-3");
  });

  it("names an untouched file", () => {
    expect(churnLabel(stat("a.ts", 0, 0))).toBe("no changes");
  });
});

describe("totalChurn", () => {
  it("sums every file and labels the count", () => {
    expect(totalChurn([stat("a.ts", 1, 2), stat("b.ts", 3, 4)])).toEqual({
      path: "2 files",
      additions: 4,
      deletions: 6,
    });
  });
});
