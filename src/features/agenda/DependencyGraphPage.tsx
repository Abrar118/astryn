import { useSearchParams } from "react-router-dom";
import { Network } from "lucide-react";
import { useIssues, useRelations, useMe } from "../../lib/queries";
import { weekWindow } from "../../lib/dates";
import { buildAgenda } from "./agenda";
import { DependencyGraph } from "./DependencyGraph";

/**
 * Standalone page hosting the task-dependency graph for the viewer's current
 * week (blocks / blocked-by, sub-issues, and related issues). Scope mirrors the
 * This Week agenda's default window.
 */
export function DependencyGraphPage() {
  const me = useMe();
  const { data: issues, isLoading: issuesLoading } = useIssues({});
  const { data: relations, isLoading: relsLoading } = useRelations();
  const [, setParams] = useSearchParams();

  const open = (id: string) => setParams({ issue: id });

  if (issuesLoading || relsLoading || me.isLoading) {
    return (
      <div className="p-4">
        <div className="h-72 animate-pulse rounded-lg bg-muted/40" />
      </div>
    );
  }

  const viewerId = me.data?.viewerId;
  const win = weekWindow(new Date(), 0);
  const groups = viewerId
    ? buildAgenda({ issues: issues ?? [], relations: relations ?? [], viewerId, window: win })
    : [];
  const items = groups.flatMap((g) => g.items);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <Network className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold leading-tight">Dependencies</span>
          <span className="text-[11px] text-muted-foreground leading-tight">
            This week's blocks, sub-issues &amp; related issues
          </span>
        </div>
      </header>
      <div className="min-h-0 flex-1 p-4">
        <DependencyGraph items={items} allIssues={issues ?? []} onOpen={open} />
      </div>
    </div>
  );
}
