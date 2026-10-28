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
  if (kind === "github") return "GitHub is turned off";
  if (kind === "clickup") return "ClickUp is turned off";
  return "Its provider is turned off";
}

/** Secondary line for a source in the picker and Settings. */
export function sourceDetail(source: DocsSource): string {
  if (source.kind === "local") return source.location ?? "";
  if (source.kind === "clickup") return "ClickUp Doc";
  return `${source.owner}/${source.repo} · ${source.branch}`;
}

/** The provider a source syncs through, for "Connect …" prompts. */
export function sourceProvider(kind: DocsSourceKind): { name: string; section: "github" | "clickup" } | null {
  if (kind === "github") return { name: "GitHub", section: "github" };
  if (kind === "clickup") return { name: "ClickUp", section: "clickup" };
  return null;
}
