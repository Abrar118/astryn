import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeftRight } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useWorkspace, type Tab } from "@/lib/tabs";
import { useIssues } from "@/lib/queries";
import { clampRatio, MIN_PANE_PX } from "@/lib/paneModel";
import { PaneTabStrip, tabIcon, tabLabel } from "./PaneTabStrip";
import { CalendarPage } from "@/features/calendar/CalendarPage";
import { IssuesView } from "@/features/issues/IssuesView";
import { InboxView } from "@/features/inbox/InboxView";
import { Settings } from "@/features/settings/Settings";
import { IssuePage } from "@/features/drawer/IssuePage";
import { AgendaView } from "@/features/agenda/AgendaView";
import { DependencyGraphPage } from "@/features/agenda/DependencyGraphPage";
import { PrsPage } from "@/features/prs/PrsPage";
import { SlackPage } from "@/features/slack/SlackPage";

const DIVIDER_PX = 6;
const STEP = 0.02;
const SPLIT_RIGHT_ID = "split-right";

function PaneContent({ tab }: { tab: Tab }) {
  switch (tab.view) {
    case "calendar":
      return <CalendarPage />;
    case "list":
      return <IssuesView />;
    case "this-week":
      return <AgendaView />;
    case "graph":
      return <DependencyGraphPage />;
    case "inbox":
      return <InboxView />;
    case "prs":
      return <PrsPage />;
    case "slack":
      return <SlackPage />;
    case "settings":
      return <Settings />;
    case "issue":
      return tab.issueId ? <IssuePage issueId={tab.issueId} tabId={tab.id} /> : null;
  }
}

/** Right-half drop target shown (single pane only) while a tab is being dragged. */
function SplitRightZone() {
  const { setNodeRef, isOver } = useDroppable({ id: SPLIT_RIGHT_ID });
  return (
    <div
      ref={setNodeRef}
      className={`absolute inset-y-0 right-0 z-20 w-1/2 border-l-2 transition-colors ${
        isOver ? "border-primary bg-primary/15" : "border-primary/50 bg-primary/5"
      }`}
    />
  );
}

export function SplitLayout() {
  const { panes, focusedPaneId, ratio, splitTabRight, swapPanes, setRatio, focusPane, moveTab } = useWorkspace();
  const { data: issues } = useIssues({});
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const isSplit = panes.length === 2;
  const [usableWidth, setUsableWidth] = useState(0);
  const [activeDragTab, setActiveDragTab] = useState<Tab | null>(null);

  const sensors = useSensors(
    // distance:5 so a plain click selects the tab instead of starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Prefer whatever is under the pointer (split zone / a specific tab), else the
  // nearest sortable — keeps the large split zone and dense tab rows both reliable.
  const collisionDetection: CollisionDetection = (args) => {
    const within = pointerWithin(args);
    return within.length > 0 ? within : closestCenter(args);
  };

  const tabById = (id: string): Tab | undefined => panes.flatMap((p) => p.tabs).find((t) => t.id === id);

  const onDragStart = (e: DragStartEvent) => setActiveDragTab(tabById(e.active.id as string) ?? null);
  const onDragCancel = () => setActiveDragTab(null);
  const onDragEnd = (e: DragEndEvent) => {
    setActiveDragTab(null);
    const { active, over } = e;
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;
    if (overId === SPLIT_RIGHT_ID) {
      splitTabRight(activeId);
      return;
    }
    const overPane = panes.find((p) => p.id === overId);
    if (overPane) {
      moveTab(activeId, overPane.id, overPane.tabs.length); // dropped on empty strip area → end
      return;
    }
    for (const p of panes) {
      const idx = p.tabs.findIndex((t) => t.id === overId);
      if (idx >= 0) {
        moveTab(activeId, p.id, idx);
        return;
      }
    }
  };

  // Re-clamp the ratio when the container width changes so no pane strands below the minimum.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isSplit) return;
    const ro = new ResizeObserver(() => {
      const usable = el.clientWidth - DIVIDER_PX;
      setUsableWidth(usable);
      const next = clampRatio(ratio, usable, MIN_PANE_PX);
      if (next !== ratio) setRatio(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isSplit, ratio, setRatio]);

  // Tear down any in-flight resize drag if the component unmounts mid-drag.
  useEffect(() => () => resizeCleanup.current?.(), []);

  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const move = (ev: globalThis.PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const usable = rect.width - DIVIDER_PX;
      setRatio(clampRatio((ev.clientX - rect.left) / usable, usable, MIN_PANE_PX));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      resizeCleanup.current = null;
    };
    resizeCleanup.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const onDividerKey = (e: KeyboardEvent) => {
    const usable = (containerRef.current?.clientWidth ?? 1000) - DIVIDER_PX;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setRatio(clampRatio(ratio - STEP, usable, MIN_PANE_PX));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setRatio(clampRatio(ratio + STEP, usable, MIN_PANE_PX));
    }
  };

  const minPct = usableWidth > 0 ? Math.min(50, Math.round((MIN_PANE_PX / usableWidth) * 100)) : 0;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div ref={containerRef} className="relative flex min-h-0 flex-1">
        {panes.map((pane, idx) => {
          const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0];
          const basis = !isSplit ? 100 : idx === 0 ? ratio * 100 : (1 - ratio) * 100;
          return (
            <div
              key={pane.id}
              onMouseDown={() => focusPane(pane.id)}
              className="flex min-w-0 flex-col"
              style={{ flexBasis: `${basis}%` }}
            >
              <PaneTabStrip
                pane={pane}
                focused={isSplit && pane.id === focusedPaneId}
                showClock={idx === panes.length - 1}
                canClose={pane.tabs.length > 1 || isSplit}
                isSplit={isSplit}
              />
              <div className="min-h-0 flex-1 overflow-hidden">
                <PaneContent key={pane.activeTabId} tab={activeTab} />
              </div>
            </div>
          );
        })}

        {isSplit && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={Math.round(ratio * 100)}
            aria-valuemin={minPct}
            aria-valuemax={100 - minPct}
            tabIndex={0}
            onPointerDown={startResize}
            onKeyDown={onDividerKey}
            className="group absolute top-0 bottom-0 z-10 flex w-1.5 -translate-x-1/2 cursor-col-resize items-center justify-center bg-border/60 outline-none hover:bg-primary/40 focus-visible:bg-primary/60"
            style={{ left: `${ratio * 100}%` }}
          >
            <button
              type="button"
              aria-label="Swap panes"
              onClick={(e) => {
                e.stopPropagation();
                swapPanes();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="pointer-events-auto flex size-6 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground opacity-0 shadow transition-opacity hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
            >
              <ArrowLeftRight className="size-3.5" />
            </button>
          </div>
        )}

        {/* Drag a tab into the right half to create the split (single-pane only). */}
        {!isSplit && activeDragTab && <SplitRightZone />}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeDragTab ? (
          <div className="flex cursor-grabbing items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-foreground shadow-lg">
            <span className="flex shrink-0">{tabIcon(activeDragTab, issues ?? [])}</span>
            <span className="max-w-[12rem] truncate">{tabLabel(activeDragTab, issues ?? [])}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
