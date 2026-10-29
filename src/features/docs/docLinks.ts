import type { DocLink, DocNode, DocsSource } from "@/lib/commands";
import { unavailableReason } from "./docSource";
import { displayLabel } from "./docTree";

/** Comma-separated tags: trimmed, blanks dropped, duplicates merged case-insensitively. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(",")) {
    const tag = raw.trim();
    if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out;
}

/** `host/path` of a web URL, without the scheme or a trailing slash. */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.host}${path}`;
  } catch {
    return url;
  }
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** What a link row shows as its name. */
export function linkLabel(link: DocLink): string {
  if (link.title) return link.title;
  if (link.kind === "url") return shortUrl(link.url ?? "");
  return displayLabel(baseName(link.docPath ?? ""));
}

/**
 * A link row's secondary line, plus why a doc link can't open (`blocked`) when
 * its source was removed or its provider is off. `sources` is undefined while
 * they load, which is not the same as removed.
 */
export function linkDetail(link: DocLink, sources: readonly DocsSource[] | undefined): { text: string; blocked?: string } {
  if (link.kind === "url") {
    try {
      return { text: new URL(link.url ?? "").host };
    } catch {
      return { text: link.url ?? "" };
    }
  }
  const path = link.docPath ?? "";
  if (!sources) return { text: path };
  const source = sources.find((s) => s.id === link.sourceId);
  if (!source) return { text: path, blocked: "Source removed" };
  // ClickUp paths are chains of page ids, meaningless to read.
  const text = source.kind === "clickup" ? source.name : `${source.name} · ${path}`;
  return source.available ? { text } : { text, blocked: unavailableReason(source.kind) };
}

export type DocChoice = { path: string; label: string; trail: string };

/**
 * The documents of a source's flat tree that match `query`, each with its
 * ancestors' names (`trail`) so ClickUp pages read by name, not id.
 */
export function docChoices(nodes: readonly DocNode[], query: string): DocChoice[] {
  const names = new Map(nodes.map((n) => [n.path, n.name]));
  const trailOf = (parent: string) => {
    if (!parent) return "";
    const parts = parent.split("/");
    return parts.map((_, i) => {
      const prefix = parts.slice(0, i + 1).join("/");
      return displayLabel(names.get(prefix) ?? parts[i]);
    }).join(" / ");
  };
  const q = query.trim().toLowerCase();
  return nodes
    .filter((n) => n.kind === "blob")
    .map((n) => ({ path: n.path, label: displayLabel(n.name), trail: trailOf(n.parentPath) }))
    .filter((c) => !q || c.label.toLowerCase().includes(q) || c.trail.toLowerCase().includes(q));
}
