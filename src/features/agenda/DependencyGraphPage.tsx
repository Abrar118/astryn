import { useSearchParams } from "react-router-dom";
import { Network } from "lucide-react";
import { useTaskRelations, useTasks, useViewer } from "../../lib/taskQueries";
import { weekWindow } from "../../lib/dates";
import { buildAgenda, dueIssues } from "./agenda";
import { DependencyGraph } from "./DependencyGraph";

/**
 * Standalone page hosting the task-dependency graph for the viewer's current
 * week (blocks / blocked-by, sub-issues, and related issues). Scope mirrors the
 * This Week agenda's default window.
 */
export function DependencyGraphPage() {
  const viewer = useViewer();
  const { data: issues, isLoading: issuesLoading } = useTasks({});
  const { data: relations, isLoading: relsLoading } = useTaskRelations();
  const [, setParams] = useSearchParams();

  const open = (id: string) => setParams({ issue: id });

  if (issuesLoading || relsLoading || viewer.isLoading) {
    return (
      <div className="p-4">
        <div className="h-72 animate-pulse rounded-lg bg-muted/40" />
      </div>
    );
  }

  const { viewerIds } = viewer;
  const win = weekWindow(new Date(), 0);
  const groups = viewerIds.length > 0
    ? buildAgenda({ issues: issues ?? [], viewerIds, window: win })
    : [];
  const rootIds = groups.flatMap((g) => dueIssues(g).map((i) => i.id));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <Network className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold leading-tight">Dependencies</span>
          <span className="text-[11px] text-muted-foreground leading-tight">
            This week's issues — expand a node to explore its neighbors
          </span>
        </div>
      </header>
      <div className="min-h-0 flex-1 p-4">
        <DependencyGraph
          rootIds={rootIds}
          issues={issues ?? []}
          relations={relations ?? []}
          onOpen={open}
        />
      </div>
    </div>
  );
}
