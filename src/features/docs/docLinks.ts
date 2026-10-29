import type { DocLink, DocLinkInput, DocNode, DocsSource } from "@/lib/commands";
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

// Mirrors the limits `validate_input` enforces in Rust (commands/doc_links.rs).
const MAX_URL = 2048;
const MAX_TITLE = 200;
const MAX_NOTE = 4000;
const MAX_TAGS = 20;
const MAX_TAG = 40;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
// eslint-disable-next-line no-control-regex
const CONTROL_BUT_LINES = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;
const length = (s: string) => [...s].length;

/** Whether Rust will accept this web address (same rules as `normalize_attachment_url`). */
function webUrlOk(raw: string): boolean {
  const url = raw.trim();
  if (!url || /\s/.test(url) || url.length > MAX_URL) return false;
  const candidate = /^https?:\/\//.test(url) ? url : url.includes("://") ? null : `https://${url}`;
  if (!candidate) return false;
  try {
    const u = new URL(candidate);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname !== "";
  } catch {
    return false;
  }
}

/**
 * Why Rust would refuse this input, in the user's words, or `null` when it is
 * fine. Checked before sending so a refusal never costs what was typed.
 */
export function linkInputProblem(input: DocLinkInput): string | null {
  if (input.kind === "url" && !webUrlOk(input.url ?? "")) return "Enter a web address, like https://example.com.";
  const title = input.title?.trim() ?? "";
  if (length(title) > MAX_TITLE || CONTROL.test(title)) return `Title must be one line of up to ${MAX_TITLE} characters.`;
  const note = input.note?.trim() ?? "";
  if (length(note) > MAX_NOTE || CONTROL_BUT_LINES.test(note)) return `Note can be up to ${MAX_NOTE.toLocaleString("en-US")} characters.`;
  if (input.tags.length > MAX_TAGS) return `Use up to ${MAX_TAGS} tags.`;
  if (input.tags.some((t) => length(t) > MAX_TAG)) return `Tags can be up to ${MAX_TAG} characters each.`;
  if (input.tags.some((t) => CONTROL.test(t))) return "Tags can't contain special characters.";
  return null;
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
