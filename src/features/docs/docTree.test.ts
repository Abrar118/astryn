import { describe, expect, it } from "vitest";
import type { DocNode } from "@/lib/commands";
import { buildDocTree, defaultDocPath, displayLabel } from "./docTree";

const node = (path: string, kind: "blob" | "tree", parentPath: string): DocNode => ({
  path,
  name: path.split("/").pop()!,
  kind,
  parentPath,
});

describe("displayLabel", () => {
  it("hides the .md extension but keeps the ordering prefix", () => {
    expect(displayLabel("01-architecture.md")).toBe("01-architecture");
    expect(displayLabel("00-overview")).toBe("00-overview");
    expect(displayLabel("README.md")).toBe("README");
    expect(displayLabel("backend")).toBe("backend");
  });
  it("strips .md case-insensitively", () => {
    expect(displayLabel("Notes.MD")).toBe("Notes");
  });
});

describe("buildDocTree", () => {
  it("nests children under their parent folders", () => {
    const flat = [
      node("02-technical", "tree", ""),
      node("02-technical/backend", "tree", "02-technical"),
      node("02-technical/backend/api.md", "blob", "02-technical/backend"),
      node("README.md", "blob", ""),
    ];
    const tree = buildDocTree(flat);
    // README sorts before the folder (README-first), so roots = [README.md, 02-technical].
    expect(tree.map((n) => n.path)).toEqual(["README.md", "02-technical"]);
    const tech = tree.find((n) => n.path === "02-technical")!;
    expect(tech.children.map((n) => n.path)).toEqual(["02-technical/backend"]);
    expect(tech.children[0].children[0].path).toBe("02-technical/backend/api.md");
  });

  it("orders siblings README-first then by numeric prefix", () => {
    const flat = [
      node("01-product", "tree", ""),
      node("00-overview", "tree", ""),
      node("README.md", "blob", ""),
    ];
    expect(buildDocTree(flat).map((n) => n.path)).toEqual([
      "README.md",
      "00-overview",
      "01-product",
    ]);
  });
});

describe("defaultDocPath", () => {
  it("prefers the root README, else the first file", () => {
    expect(
      defaultDocPath([node("README.md", "blob", ""), node("a.md", "blob", "")]),
    ).toBe("README.md");
    expect(defaultDocPath([node("x", "tree", ""), node("x/a.md", "blob", "x")])).toBe(
      "x/a.md",
    );
    expect(defaultDocPath([node("x", "tree", "")])).toBeNull();
  });
});
