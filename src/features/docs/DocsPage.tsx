import { useEffect, useMemo, useState } from "react";
import { BookText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/tabs";
import { useDocContent, useDocsStatus, useDocsSync, useDocsTree } from "@/lib/queries";
import { buildDocTree, defaultDocPath } from "./docsTree";
import { DocsTree } from "./DocsTree";
import { DocViewer } from "./DocViewer";

export function DocsPage() {
  const { setActiveView } = useWorkspace();
  const { data: status } = useDocsStatus();
  const tokenPresent = status?.tokenPresent ?? false;
  const { data: flat } = useDocsTree();
  const sync = useDocsSync(tokenPresent);

  const [selected, setSelected] = useState<string | null>(null);
  const tree = useMemo(() => buildDocTree(flat ?? []), [flat]);

  // Auto-select the root README (or first file) once the tree is available.
  useEffect(() => {
    if (!selected && flat && flat.length > 0) {
      const def = defaultDocPath(flat);
      if (def) setSelected(def);
    }
  }, [flat, selected]);

  const { data: content } = useDocContent(selected);

  if (status && !tokenPresent) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-muted/50">
          <BookText className="size-7 text-muted-foreground" />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold text-foreground">Docs</h1>
          <p className="max-w-xs text-sm text-muted-foreground">
            Connect your GitHub account to browse the project documentation.
          </p>
        </div>
        <Button onClick={() => setActiveView("settings")}>Connect GitHub</Button>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-background/80 px-5 py-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-base font-semibold text-foreground">Docs</h1>
          {sync.isError && (
            <span className="text-xs text-amber-400">Sync failed — showing cached docs.</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Refresh"
          disabled={sync.isFetching}
          onClick={() => sync.refetch()}
        >
          <RefreshCw className={`size-4 ${sync.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-border/60 bg-sidebar/30 py-3">
          {tree.length === 0 ? (
            <p className="px-4 py-6 text-xs text-muted-foreground">
              {sync.isFetching ? "Loading docs…" : "No docs cached yet."}
            </p>
          ) : (
            <DocsTree tree={tree} selectedPath={selected} onSelect={setSelected} />
          )}
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto">
          {selected && content != null ? (
            <DocViewer markdown={content} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a document to read.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
