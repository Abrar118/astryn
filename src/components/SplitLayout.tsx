import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeftRight } from "lucide-react";
import { useWorkspace, type Tab } from "@/lib/tabs";
import { clampRatio, MIN_PANE_PX } from "@/lib/paneModel";
import { PaneTabStrip } from "./PaneTabStrip";
import { CalendarPage } from "@/features/calendar/CalendarPage";
import { IssuesView } from "@/features/issues/IssuesView";
import { InboxView } from "@/features/inbox/InboxView";
import { Settings } from "@/features/settings/Settings";
import { IssuePage } from "@/features/drawer/IssuePage";

const DIVIDER_PX = 6;
const STEP = 0.02;
const TAB_DRAG_THRESHOLD = 5;

function PaneContent({ tab }: { tab: Tab }) {
  switch (tab.view) {
    case "calendar":
      return <CalendarPage />;
    case "list":
      return <IssuesView />;
    case "inbox":
      return <InboxView />;
    case "settings":
      return <Settings />;
    case "issue":
      return tab.issueId ? <IssuePage issueId={tab.issueId} tabId={tab.id} /> : null;
  }
}

export function SplitLayout() {
  const { panes, focusedPaneId, ratio, splitTabRight, swapPanes, setRatio, focusPane, selectTab, moveTabToOtherPane } =
    useWorkspace();
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const isSplit = panes.length === 2;
  const [usableWidth, setUsableWidth] = useState(0);

  // ── Tab drag (pointer-driven) ───────────────────────────────────────────────
  // HTML5 drag-and-drop `drop` events do not fire in Tauri's WKWebView (same
  // reason the issue board uses pointer events), so tab moves are driven manually:
  // capture the pointer on the tab, then resolve the drop target at pointer-up via
  // elementFromPoint + data attributes. A move below threshold is treated as a
  // click (tab select).
  const tabGesture = useRef<{ tabId: string; sourcePaneId: string; x: number; y: number; label: string; started: boolean } | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [tabGhost, setTabGhost] = useState<{ label: string; x: number; y: number } | null>(null);

  const onTabPointerDown = (e: ReactPointerEvent, tabId: string, sourcePaneId: string, label: string) => {
    if (e.button !== 0) return;
    tabGesture.current = { tabId, sourcePaneId, x: e.clientX, y: e.clientY, label, started: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onTabPointerMove = (e: ReactPointerEvent) => {
    const g = tabGesture.current;
    if (!g) return;
    if (!g.started) {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < TAB_DRAG_THRESHOLD) return;
      g.started = true;
      setDraggingTabId(g.tabId);
    }
    setTabGhost({ label: g.label, x: e.clientX, y: e.clientY });
  };

  const onTabPointerUp = (e: ReactPointerEvent) => {
    const g = tabGesture.current;
    tabGesture.current = null;
    setDraggingTabId(null);
    setTabGhost(null);
    if (!g) return;
    if (!g.started) {
      selectTab(g.tabId); // below threshold → a click, not a drag
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    if (!el) return;
    // Single-pane right-half zone → create the split.
    if (el.closest("[data-split-right]")) {
      splitTabRight(g.tabId);
      return;
    }
    // Dropped over the OTHER pane (its strip or content) → move it there.
    const targetPaneId = el.closest<HTMLElement>("[data-pane-id]")?.dataset.paneId;
    if (targetPaneId && targetPaneId !== g.sourcePaneId) moveTabToOtherPane(g.tabId);
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
    <div ref={containerRef} className="relative flex min-h-0 flex-1">
      {panes.map((pane, idx) => {
        const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0];
        const basis = !isSplit ? 100 : idx === 0 ? ratio * 100 : (1 - ratio) * 100;
        return (
          <div
            key={pane.id}
            data-pane-id={pane.id}
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
              draggingTabId={draggingTabId}
              onTabPointerDown={onTabPointerDown}
              onTabPointerMove={onTabPointerMove}
              onTabPointerUp={onTabPointerUp}
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
      {!isSplit && draggingTabId && (
        <div
          data-split-right
          className="absolute inset-y-0 right-0 z-20 w-1/2 border-l-2 border-primary/60 bg-primary/10"
        />
      )}

      {tabGhost && (
        <div
          className="pointer-events-none fixed z-50 max-w-48 truncate rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground shadow-2xl"
          style={{ left: tabGhost.x + 12, top: tabGhost.y + 12 }}
        >
          {tabGhost.label}
        </div>
      )}
    </div>
  );
}
