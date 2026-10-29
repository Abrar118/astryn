import { describe, expect, it } from "vitest";
import type { DocLink, DocNode, DocsSource } from "@/lib/commands";
import { docChoices, linkDetail, linkInputProblem, linkLabel, parseTags } from "./docLinks";

function link(over: Partial<DocLink>): DocLink {
  return {
    id: "dl_1",
    tracker: "linear",
    taskId: "i1",
    kind: "url",
    url: "https://example.com/specs/auth",
    sourceId: null,
    docPath: null,
    title: null,
    note: null,
    tags: [],
    createdAt: "t",
    updatedAt: "t",
    ...over,
  };
}

const SOURCE: DocsSource = {
  id: "acme/docs@main",
  kind: "github",
  name: "Platform docs",
  owner: "acme",
  repo: "docs",
  branch: "main",
  location: null,
  url: null,
  lastSyncedAt: null,
  fileCount: 0,
  truncated: false,
  available: true,
};

describe("parseTags", () => {
  it("splits on commas, trims, drops blanks and merges case-insensitive duplicates", () => {
    expect(parseTags(" ops, deploy ,, OPS ,")).toEqual(["ops", "deploy"]);
    expect(parseTags("   ")).toEqual([]);
  });
});

describe("linkLabel", () => {
  it("prefers the title, then the host, then the document name", () => {
    expect(linkLabel(link({ title: "Auth spec" }))).toBe("Auth spec");
    expect(linkLabel(link({}))).toBe("example.com/specs/auth");
    expect(linkLabel(link({ kind: "doc", url: null, sourceId: "s", docPath: "guide/01-setup.md" }))).toBe("01-setup");
  });
});

describe("linkDetail", () => {
  it("names the host for web links", () => {
    expect(linkDetail(link({ title: "Auth spec" }), [])).toEqual({ text: "example.com" });
  });

  it("names the source and path for doc links, and says why one can't open", () => {
    const d = link({ kind: "doc", url: null, sourceId: SOURCE.id, docPath: "guide/setup.md" });
    expect(linkDetail(d, [SOURCE])).toEqual({ text: "Platform docs · guide/setup.md" });
    expect(linkDetail(d, [{ ...SOURCE, available: false }])).toEqual({
      text: "Platform docs · guide/setup.md",
      blocked: "GitHub is turned off",
    });
    expect(linkDetail(d, [])).toEqual({ text: "guide/setup.md", blocked: "Source removed" });
    // ClickUp paths are page ids, so only the Doc's name is shown.
    expect(linkDetail({ ...d, docPath: "p1/p2" }, [{ ...SOURCE, kind: "clickup" }])).toEqual({ text: "Platform docs" });
  });

  it("treats sources that are still loading as not yet known rather than removed", () => {
    const d = link({ kind: "doc", url: null, sourceId: SOURCE.id, docPath: "a.md" });
    expect(linkDetail(d, undefined)).toEqual({ text: "a.md" });
  });
});

describe("docChoices", () => {
  const nodes: DocNode[] = [
    { path: "guide", name: "guide", kind: "tree", parentPath: "" },
    { path: "guide/setup.md", name: "setup.md", kind: "blob", parentPath: "guide" },
    { path: "README.md", name: "README.md", kind: "blob", parentPath: "" },
    { path: "p1", name: "Onboarding", kind: "blob", parentPath: "" },
    { path: "p1/p2", name: "First week", kind: "blob", parentPath: "p1" },
  ];

  it("lists documents only, with their folder trail by name", () => {
    expect(docChoices(nodes, "")).toEqual([
      { path: "guide/setup.md", label: "setup", trail: "guide" },
      { path: "README.md", label: "README", trail: "" },
      { path: "p1", label: "Onboarding", trail: "" },
      { path: "p1/p2", label: "First week", trail: "Onboarding" },
    ]);
  });

  it("filters by name or trail, case-insensitively", () => {
    expect(docChoices(nodes, "GUIDE").map((c) => c.path)).toEqual(["guide/setup.md"]);
    expect(docChoices(nodes, "onboard").map((c) => c.path)).toEqual(["p1", "p1/p2"]);
  });
});

describe("linkInputProblem", () => {
  const web = (url: string, over = {}) => ({ kind: "url" as const, url, tags: [], ...over });

  it("accepts what Rust accepts", () => {
    expect(linkInputProblem(web("https://example.com/a"))).toBeNull();
    expect(linkInputProblem(web("example.com/a"))).toBeNull(); // https:// is added
    expect(linkInputProblem({ kind: "doc", sourceId: "s", docPath: "a.md", tags: ["x"] })).toBeNull();
  });

  it("refuses what Rust would refuse, before anything is sent", () => {
    for (const url of ["hello world", "ftp://x.com", "javascript:alert(1)", "https://", `https://x.com/${"a".repeat(2048)}`]) {
      expect(linkInputProblem(web(url)), url).toMatch(/web address/);
    }
    expect(linkInputProblem(web("https://x.com", { title: "two\nlines" }))).toMatch(/Title/);
    expect(linkInputProblem(web("https://x.com", { title: "a".repeat(201) }))).toMatch(/Title/);
    expect(linkInputProblem(web("https://x.com", { note: "a".repeat(4001) }))).toMatch(/Note/);
    expect(linkInputProblem(web("https://x.com", { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }))).toMatch(/20 tags/);
    expect(linkInputProblem(web("https://x.com", { tags: ["a".repeat(41)] }))).toMatch(/40 characters/);
    expect(linkInputProblem(web("https://x.com", { tags: ["a\u0007"] }))).toMatch(/Tags/);
  });
});