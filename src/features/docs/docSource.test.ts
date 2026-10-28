import { describe, expect, it } from "vitest";
import type { DocsSource } from "@/lib/commands";
import { docFormat, sourceDetail } from "./docSource";

const base: DocsSource = {
  id: "acme/docs@main",
  kind: "github",
  name: "Docs",
  owner: "acme",
  repo: "docs",
  branch: "main",
  location: null,
  url: "https://github.com/acme/docs/tree/main",
  lastSyncedAt: null,
  fileCount: 0,
  truncated: false,
  available: true,
};

describe("docFormat", () => {
  it("reads local files by extension, case-insensitively", () => {
    expect(docFormat("local", "README.md")).toBe("markdown");
    expect(docFormat("local", "notes.markdown")).toBe("markdown");
    expect(docFormat("local", "log.TXT")).toBe("text");
    expect(docFormat("local", "spec.Pdf")).toBe("pdf");
  });

  it("treats every repository file as markdown", () => {
    expect(docFormat("github", "weird.pdf")).toBe("markdown");
  });
});

describe("sourceDetail", () => {
  it("describes a repository by owner/repo and branch", () => {
    expect(sourceDetail(base)).toBe("acme/docs · main");
  });

  it("describes a local folder by its path", () => {
    expect(
      sourceDetail({ ...base, kind: "local", owner: null, repo: null, branch: null, location: "/home/me/notes" }),
    ).toBe("/home/me/notes");
  });
});
