// src/lib/queries.ts — temporary scaffold; Task 9 replaces this entire file.
import type { QueryClient } from "@tanstack/react-query";
export function useSyncLoop(): { isSyncing: boolean; refresh: () => void } {
  return { isSyncing: false, refresh: () => {} };
}
export function clearWorkspaceQueries(_qc: QueryClient): void {}
