import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocalTasks, useLocalTree } from "@/lib/localTaskQueries";
import type { LocalSpace, LocalTask } from "@/lib/commands";
import { dhakaToday } from "@/lib/dates";
import { useIssueMenu } from "@/features/issues/IssueContextMenu";
import { isClosed, statusesForList, visibleTasks } from "./localTaskModel";
import { LampMessage } from "./LocalFields";
import { TaskSidebar } from "./TaskSidebar";
import { WorkflowDialog, type WorkflowScope } from "./WorkflowDialog";
import { SprintDialog } from "./SprintDialog";
import { ListView, type ViewProps } from "./views/ListView";
import { BoardView } from "./views/BoardView";
import { TableView } from "./views/TableView";
import { CalendarView } from "./views/CalendarView";
import { TimelineView } from "./views/TimelineView";

type LocalView = "list" | "board" | "table" | "calendar" | "timeline";

const VIEWS: { id: LocalView; label: string }[] = [
  { id: "list", label: "list" },
  { id: "board", label: "board" },
  { id: "table", label: "table" },
  { id: "calendar", label: "calendar" },
  { id: "timeline", label: "timeline" },
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
    return (
      <div className="lt-surface h-full">
        <LampMessage tone="danger" title="Couldn't read your local tasks" body="Try reopening the tab. Your tasks and backups are untouched." />
      </div>
    );
  }
  if (treeLoading || !tree) {
    return (
      <div className="lt-surface flex h-full">
        <div className="lt-nav shrink-0 border-r border-sidebar-border bg-sidebar" />
        <LampMessage tone="off" title="Reading local tasks…" />
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
    <div className="lt-surface flex h-full min-h-0">
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
            <header className="border-b border-border px-4 pt-4 pb-2">
              <div className="flex min-w-0 items-center gap-3">
                <h1 className="min-w-0 flex-1 truncate text-[20px] font-semibold tracking-tight text-foreground">
                  <span className="font-normal text-muted-foreground">{space?.name} / </span>
                  {list.name}
                </h1>
                <Button onClick={newTask} title="New task (N)">
                  <Plus /> New task
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <div role="tablist" aria-label="View" className="lt-band -ml-2">
                  {VIEWS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      role="tab"
                      aria-selected={stored.view === v.id}
                      onClick={() => setStored((s) => ({ ...s, view: v.id }))}
                      className="lt-band-key lt-focus"
                    >
                      <span aria-hidden className="lt-band-lamp" />
                      {v.label}
                    </button>
                  ))}
                </div>
                <div className="lt-band">
                  <select
                    aria-label="Sprint"
                    value={activeSprint ?? ""}
                    onChange={(e) => setSprintId(e.target.value || null)}
                    disabled={sprints.length === 0}
                    className="lt-band-key lt-focus bg-transparent pr-1"
                  >
                    <option value="">{sprints.length === 0 ? "no sprints" : "all sprints"}</option>
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
                    className="lt-band-key lt-focus"
                  >
                    <span aria-hidden className="lt-band-lamp" />
                    assigned to me
                  </button>
                  <button
                    type="button"
                    aria-pressed={stored.showClosed}
                    onClick={() => setStored((s) => ({ ...s, showClosed: !s.showClosed }))}
                    className="lt-band-key lt-focus"
                  >
                    <span aria-hidden className="lt-band-lamp" />
                    show closed
                  </button>
                  <span className="pl-2 text-[12px] tabular-nums text-muted-foreground">
                    {tasks.length} task{tasks.length === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
            </header>
            <div className="drawer-scrollbar relative min-h-0 flex-1 overflow-y-auto">
              {tasksLoading ? (
                <LampMessage tone="off" title="Reading tasks…" />
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
          <div className="px-4 pt-4">
            <h1 className="text-[20px] font-semibold tracking-tight text-foreground">Tasks</h1>
            <LampMessage
              tone="off"
              title="No lists yet"
              body="Add a list to a space in the sidebar: the + beside the space name."
            />
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
