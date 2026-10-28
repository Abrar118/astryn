import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, GanttChart, KanbanSquare, List as ListIcon, Plus, Table2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocalTasks, useLocalTree } from "@/lib/localTaskQueries";
import type { LocalSpace, LocalTask } from "@/lib/commands";
import { dhakaToday } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useIssueMenu } from "@/features/issues/IssueContextMenu";
import { isClosed, statusesForList, visibleTasks } from "./localTaskModel";
import { TaskSidebar } from "./TaskSidebar";
import { WorkflowDialog, type WorkflowScope } from "./WorkflowDialog";
import { SprintDialog } from "./SprintDialog";
import { ListView, type ViewProps } from "./views/ListView";
import { BoardView } from "./views/BoardView";
import { TableView } from "./views/TableView";
import { CalendarView } from "./views/CalendarView";
import { TimelineView } from "./views/TimelineView";

type LocalView = "list" | "board" | "table" | "calendar" | "timeline";

const VIEWS: { id: LocalView; label: string; icon: LucideIcon }[] = [
  { id: "list", label: "List", icon: ListIcon },
  { id: "board", label: "Board", icon: KanbanSquare },
  { id: "table", label: "Table", icon: Table2 },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "timeline", label: "Timeline", icon: GanttChart },
];

const STORE_KEY = "astryn.local-tasks.view";
type Stored = { listId: string | null; view: LocalView; showClosed: boolean; mineOnly: boolean };

function loadStored(): Stored {
  const fallback: Stored = { listId: null, view: "list", showClosed: false, mineOnly: false };
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as Partial<Stored> | null;
    if (!raw) return fallback;
    return {
      listId: typeof raw.listId === "string" ? raw.listId : null,
      view: VIEWS.some((v) => v.id === raw.view) ? (raw.view as LocalView) : "list",
      showClosed: raw.showClosed === true,
      mineOnly: raw.mineOnly === true,
    };
  } catch {
    return fallback;
  }
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable;
}

const TOGGLE =
  "cursor-pointer rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The local-tasks workspace: spaces/lists sidebar, a list header with the view switcher, and the current view. */
export function LocalTasksPage() {
  const today = dhakaToday();
  const [stored, setStored] = useState<Stored>(loadStored);
  const [sprintId, setSprintId] = useState<string | null>(null);
  const [addSignal, setAddSignal] = useState(0);
  const [workflow, setWorkflow] = useState<WorkflowScope | null>(null);
  const [sprintSpace, setSprintSpace] = useState<LocalSpace | null>(null);
  const [, setParams] = useSearchParams();
  const { openMenu } = useIssueMenu();
  const { data: tree, isLoading: treeLoading, isError: treeError } = useLocalTree();
  const { data: allTasks } = useLocalTasks({});

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(stored));
    } catch {
      // Storage unavailable: the choice lasts for this session only.
    }
  }, [stored]);

  const listId = tree?.lists.some((l) => l.id === stored.listId) ? stored.listId : tree?.lists[0]?.id ?? null;
  const list = tree?.lists.find((l) => l.id === listId);
  const space = tree?.spaces.find((s) => s.id === list?.spaceId);
  const { data: listTasks, isLoading: tasksLoading } = useLocalTasks(listId ? { teamId: listId } : { teamId: "" });
  const statuses = statusesForList(tree, listId ?? "");
  const sprints = tree?.sprints.filter((s) => s.spaceId === list?.spaceId) ?? [];
  const activeSprint = sprints.some((s) => s.id === sprintId) ? sprintId : null;

  const tasks = useMemo(
    () => visibleTasks(listTasks ?? [], { showClosed: stored.showClosed, mineOnly: stored.mineOnly, sprintId: activeSprint }),
    [listTasks, stored.showClosed, stored.mineOnly, activeSprint],
  );
  const openCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of (allTasks ?? []) as LocalTask[]) {
      if (!isClosed(t) && t.teamId) m.set(t.teamId, (m.get(t.teamId) ?? 0) + 1);
    }
    return m;
  }, [allTasks]);

  const newTask = () => {
    if (stored.view !== "list" && stored.view !== "board") setStored((s) => ({ ...s, view: "list" }));
    setAddSignal((n) => n + 1);
  };

  // N adds a task, like the inline "Add task" row.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector("[data-command-shortcut-blocker], [data-popover-open]")) return;
      e.preventDefault();
      newTask();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (treeError) {
    return <p className="p-6 text-sm text-destructive">Couldn't read your local tasks. Try reopening the tab.</p>;
  }
  if (treeLoading || !tree) {
    return (
      <div className="flex h-full">
        <div className="w-60 shrink-0 border-r border-border bg-sidebar" />
        <div className="flex-1 space-y-2 p-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded-md bg-muted/40" />
          ))}
        </div>
      </div>
    );
  }

  const viewProps: ViewProps = {
    tasks,
    statuses,
    listId: listId ?? "",
    today,
    onOpen: (id) => setParams({ issue: id }),
    onMenu: (e: MouseEvent, id) => openMenu(e, id),
    addSignal,
  };

  return (
    <div className="flex h-full min-h-0">
      <TaskSidebar
        tree={tree}
        selectedListId={listId}
        openCounts={openCounts}
        onSelect={(id) => {
          setStored((s) => ({ ...s, listId: id }));
          setSprintId(null);
        }}
        actions={{ onWorkflow: setWorkflow, onSprints: setSprintSpace }}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        {list ? (
          <>
            <header className="flex flex-wrap items-center gap-3 border-b border-border/60 px-4 py-3">
              <h1 className="min-w-0 truncate text-lg font-semibold leading-tight tracking-tight text-foreground">
                <span className="font-normal text-muted-foreground">{space?.name} / </span>
                {list.name}
              </h1>
              <div role="tablist" aria-label="View" className="ml-auto inline-flex items-center rounded-md border border-border bg-secondary/40 p-0.5">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    role="tab"
                    aria-selected={stored.view === v.id}
                    onClick={() => setStored((s) => ({ ...s, view: v.id }))}
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      stored.view === v.id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <v.icon className="size-3.5" />
                    {v.label}
                  </button>
                ))}
              </div>
            </header>
            <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2">
              <select
                aria-label="Sprint"
                value={activeSprint ?? ""}
                onChange={(e) => setSprintId(e.target.value || null)}
                disabled={sprints.length === 0}
                className="cursor-pointer rounded-md border border-border bg-secondary/40 py-1 pl-2.5 pr-7 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">{sprints.length === 0 ? "No sprints" : "All sprints"}</option>
                {sprints.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-pressed={stored.mineOnly}
                onClick={() => setStored((s) => ({ ...s, mineOnly: !s.mineOnly }))}
                className={cn(TOGGLE, stored.mineOnly ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                Assigned to me
              </button>
              <button
                type="button"
                aria-pressed={stored.showClosed}
                onClick={() => setStored((s) => ({ ...s, showClosed: !s.showClosed }))}
                className={cn(TOGGLE, stored.showClosed ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                Show closed
              </button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {tasks.length} task{tasks.length === 1 ? "" : "s"}
              </span>
              <Button size="sm" className="ml-auto" onClick={newTask} title="New task (N)">
                <Plus /> New task
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {tasksLoading ? (
                <div className="space-y-2 p-4">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-8 animate-pulse rounded-md bg-muted/40" />
                  ))}
                </div>
              ) : stored.view === "list" ? (
                <ListView {...viewProps} />
              ) : stored.view === "board" ? (
                <BoardView {...viewProps} />
              ) : stored.view === "table" ? (
                <TableView {...viewProps} />
              ) : stored.view === "calendar" ? (
                <CalendarView {...viewProps} />
              ) : (
                <TimelineView {...viewProps} />
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-start gap-2 p-6">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">No lists yet</h1>
            <p className="text-sm text-muted-foreground">Add a list to a space in the sidebar (the + beside the space name).</p>
          </div>
        )}
      </main>
      {workflow && <WorkflowDialog scope={workflow} tree={tree} onClose={() => setWorkflow(null)} />}
      {sprintSpace && (
        <SprintDialog spaceId={sprintSpace.id} spaceName={sprintSpace.name} tree={tree} onClose={() => setSprintSpace(null)} />
      )}
    </div>
  );
}
