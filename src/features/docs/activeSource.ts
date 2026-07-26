import { useSyncExternalStore } from "react";
import type { DocsSource } from "@/lib/commands";

/**
 * Which docs source the Docs page shows. This lives in the renderer rather than
 * the database so every Tauri command stays stateless — each one takes an
 * explicit `sourceId` — which keeps the Rust side unit-testable and means two
 * split panes can look at two different repos at once.
 */
export const ACTIVE_DOCS_SOURCE_KEY = "astryn.docsSource";

/**
 * Pure: the source to display, given what's configured and what was last chosen.
 * Falls back to the first source when the stored id names a source that has since
 * been removed, so deleting the active source doesn't strand the page on nothing.
 */
export function resolveActiveSource(
  sources: readonly DocsSource[],
  preferredId: string | null,
): DocsSource | null {
  if (sources.length === 0) return null;
  return sources.find((s) => s.id === preferredId) ?? sources[0];
}

let cached: string | null | undefined;
const listeners = new Set<() => void>();

export function loadActiveSourceId(): string | null {
  if (cached === undefined) {
    try {
      cached = localStorage.getItem(ACTIVE_DOCS_SOURCE_KEY);
    } catch {
      cached = null;
    }
  }
  return cached;
}

/** Remember the chosen source as the default for newly opened Docs tabs. */
export function saveActiveSourceId(id: string): void {
  cached = id;
  try {
    localStorage.setItem(ACTIVE_DOCS_SOURCE_KEY, id);
  } catch {
    /* storage unavailable — keep in-memory only */
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive read of the persisted default source id. */
export function useStoredSourceId(): string | null {
  return useSyncExternalStore(subscribe, loadActiveSourceId);
}

/** Test-only: drop the memoised value so a fresh localStorage is re-read. */
export function resetActiveSourceCache(): void {
  cached = undefined;
}
