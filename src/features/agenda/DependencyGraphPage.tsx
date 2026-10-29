import { useSearchParams } from "react-router-dom";
import { useTaskRelations, useTasks, useViewer } from "../../lib/taskQueries";
import { weekWindow } from "../../lib/dates";
import { buildAgenda, dueIssues } from "./agenda";
import { DependencyGraph } from "./DependencyGraph";
import { LampMessage } from "./LampMessage";

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
  const loading = issuesLoading || relsLoading || viewer.isLoading;

  const { viewerIds } = viewer;
  const win = weekWindow(new Date(), 0);
  const groups = !loading && viewerIds.length > 0
    ? buildAgenda({ issues: issues ?? [], viewerIds, window: win })
    : [];
  const rootIds = groups.flatMap((g) => dueIssues(g).map((i) => i.id));

  return (
    <main className="flex h-full flex-col overflow-hidden">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-5 pb-3">
        <h1 className="text-[20px] font-semibold tracking-tight text-foreground">Dependencies</h1>
        <p className="text-[13px] text-muted-foreground">
          This week's issues · expand a node to explore its neighbors
        </p>
      </header>
      {loading ? (
        <LampMessage
          tone="off"
          title="Reading cached tasks…"
          body="The graph appears as soon as tasks and their relations are read."
          className="border-t border-border"
        />
      ) : (
        <div className="min-h-0 flex-1">
          <DependencyGraph
            rootIds={rootIds}
            issues={issues ?? []}
            relations={relations ?? []}
            onOpen={open}
          />
        </div>
      )}
    </main>
  );
}
