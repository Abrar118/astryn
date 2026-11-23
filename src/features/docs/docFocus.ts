import { useSyncExternalStore } from "react";

/**
 * "Open this doc scrolled to this line", handed from a search result to the
 * Docs page that shows the doc. Held outside React because the page may not
 * exist yet (a new tab is still mounting) or may already be open on that doc.
 */
export type DocFocus = { sourceId: string; path: string; line: number };

let pending: DocFocus | null = null;
const listeners = new Set<() => void>();

function set(next: DocFocus | null) {
  pending = next;
  listeners.forEach((l) => l());
}

export const requestDocFocus = (focus: DocFocus) => set(focus);
export const clearDocFocus = () => set(null);

export function usePendingDocFocus(): DocFocus | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pending,
  );
}

/**
 * The heading a 1-based `line` falls under: its position among the document's
 * headings and its text. Mirrors the indexer's chunker (`# ` headings only,
 * `#` inside code fences ignored) so both count the same headings.
 */
export function headingAt(markdown: string, line: number): { index: number; text: string } | null {
  let fence: string | null = null;
  let found: { index: number; text: string } | null = null;
  let count = 0;
  for (const [i, raw] of markdown.split(/\r?\n/).entries()) {
    if (i + 1 > line) break;
    const marker = ["```", "~~~"].find((m) => raw.trimStart().startsWith(m));
    if (marker) {
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = /^(#{1,6}) (.*)$/.exec(raw);
    if (m) found = { index: count++, text: m[2].trim().replace(/#+$/, "").trim() };
  }
  return found;
}

/** Character offset where 1-based `line` starts. */
export function lineOffset(text: string, line: number): number {
  let offset = 0;
  for (let n = 1; n < line; n++) {
    const next = text.indexOf("\n", offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  return offset;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** The rendered heading for `target`: by position when its text agrees, else by text, else by position. */
export function pickHeading(
  headings: HTMLElement[],
  target: { index: number; text: string },
): HTMLElement | undefined {
  const byIndex = headings[target.index];
  if (byIndex && norm(byIndex.textContent ?? "") === norm(target.text)) return byIndex;
  return headings.find((h) => norm(h.textContent ?? "") === norm(target.text)) ?? byIndex;
}
