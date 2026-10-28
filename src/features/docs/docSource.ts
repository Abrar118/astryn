import type { DocsSource, DocsSourceKind } from "@/lib/commands";

export type DocFormat = "markdown" | "text" | "pdf";

/**
 * Which viewer a document needs. Repositories only sync Markdown; local folders
 * also carry plain text (shown verbatim, not parsed) and PDFs.
 */
export function docFormat(kind: DocsSourceKind, name: string): DocFormat {
  if (kind !== "local") return "markdown";
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "txt") return "text";
  return "markdown";
}

/** Why a source can't be read right now (`available: false`). */
export function unavailableReason(kind: DocsSourceKind): string {
  return kind === "github" ? "GitHub is turned off" : "Its provider is turned off";
}

/** Secondary line for a source in the picker and Settings. */
export function sourceDetail(source: DocsSource): string {
  if (source.kind === "local") return source.location ?? "";
  return `${source.owner}/${source.repo} · ${source.branch}`;
}
