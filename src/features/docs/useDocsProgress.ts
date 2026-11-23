import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { gooeyToast } from "goey-toast";

export type DocsProgress = {
  /** `reading`: files split into searchable sections. `embedding`: meaning vectors. */
  phase: "reading" | "embedding";
  done: number;
  /** 0 while the total is not known yet. */
  total: number;
};

type DocsProgressEvent = DocsProgress & { running: boolean; failed: boolean };

/**
 * Progress of the background indexing (`docs:progress`). Refreshes the index
 * status and search results when a phase ends. `null` while nothing is running.
 */
export function useDocsProgress(): DocsProgress | null {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<DocsProgress | null>(null);

  useEffect(() => {
    // Caught: outside a real Tauri webview (e.g. component tests) listen() rejects.
    const unlisten = listen<DocsProgressEvent>("docs:progress", ({ payload }) => {
      if (payload.running) {
        setProgress({ phase: payload.phase, done: payload.done, total: payload.total });
        return;
      }
      setProgress(null);
      qc.invalidateQueries({ queryKey: ["docs-index-status"] });
      qc.invalidateQueries({ queryKey: ["docs-search"] });
      if (payload.failed) gooeyToast.error("Meaning-based search could not finish. Try “Update search”.");
    }).catch(() => () => {});
    return () => void unlisten.then((f) => f());
  }, [qc]);

  return progress;
}
