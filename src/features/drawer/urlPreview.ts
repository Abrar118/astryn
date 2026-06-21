/**
 * Pure helpers for the standalone-URL preview feature. No React, no Milkdown.
 * Shared by the preview node view (rendering) and the tooltip toggle (commands).
 */

/** A single http(s) URL with surrounding whitespace, or null otherwise. */
export function parseHttpUrl(text: string): URL | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url;
}

/** Host without a leading `www.`, for use as a link label. */
export function hostLabel(href: string): string {
  try {
    return new URL(href).host.replace(/^www\./, "");
  } catch {
    return href;
  }
}

export type UrlParaNode = { text: string; linkHref: string | null };
export type UrlParaKind = "preview" | "link" | "none";

/**
 * Classify a paragraph whose sole content is one text node.
 * - "preview": the text is an http(s) URL and either has no link mark or has a
 *   link mark whose href equals the URL (the gfm-autolinked-literal case).
 * - "link": the text has a link mark whose href differs from the visible text
 *   (a labeled link, e.g. `[github.com](https://github.com/)`).
 * - "none": not a URL paragraph.
 */
export function classifyUrlParagraph(node: UrlParaNode): UrlParaKind {
  const asUrl = parseHttpUrl(node.text);
  if (node.linkHref) {
    if (asUrl && sameUrl(node.linkHref, node.text)) return "preview";
    return "link";
  }
  return asUrl ? "preview" : "none";
}

function sameUrl(a: string, b: string): boolean {
  const pa = parseHttpUrl(a);
  const pb = parseHttpUrl(b);
  if (!pa || !pb) return a.trim() === b.trim();
  return pa.href === pb.href;
}
