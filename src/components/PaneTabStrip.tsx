import { useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import { Calendar, FileText, Inbox, List, Plus, Settings as SettingsIcon, X } from "lucide-react";
import { useWorkspace, type Pane, type ViewKind } from "@/lib/tabs";
import { useIssues } from "@/lib/queries";
import { DualClock } from "@/features/home/DualClock";
import { TabContextMenu } from "./TabContextMenu";

export const TAB_DND_TYPE = "application/x-astryn-tab";

const META: Record<Exclude<ViewKind, "issue">, { label: string; icon: ReactNode }> = {
  calendar: { label: "Calendar", icon: <Calendar className="size-3.5" /> },
  list: { label: "Issues", icon: <List className="size-3.5" /> },
  inbox: { label: "Inbox", icon: <Inbox className="size-3.5" /> },
  settings: { label: "Settings", icon: <SettingsIcon className="size-3.5" /> },
};

export function PaneTabStrip({
  pane,
  focused,
  showClock,
  canClose,
  isSplit,
}: {
  pane: Pane;
  focused: boolean;
  showClock: boolean;
  canClose: boolean;
  isSplit: boolean;
}) {
  const { selectTab, closeTab, addTabIn, focusPane, moveTabToOtherPane } = useWorkspace();
  const { data: issues } = useIssues({});
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);

  const onDragStart = (e: DragEvent, tabId: string) => {
    e.dataTransfer.setData(TAB_DND_TYPE, tabId);
    e.dataTransfer.effectAllowed = "move";
  };

  // Dropping a tab from the OTHER pane onto this strip moves it here.
  const onStripDrop = (e: DragEvent) => {
    e.preventDefault();
    const tabId = e.dataTransfer.getData(TAB_DND_TYPE);
    if (!tabId || pane.tabs.some((t) => t.id === tabId)) return; // own tab → no-op
    moveTabToOtherPane(tabId);
  };

  const openMenu = (e: MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ tabId, x: e.clientX, y: e.clientY });
  };

  return (
    <div
      onMouseDown={() => focusPane(pane.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onStripDrop}
      className={`flex items-center gap-1 border-b bg-background px-2 py-1.5 ${
        focused ? "border-b-border" : "border-b-border/60"
      }`}
    >
      {focused && <span className="mr-0.5 h-4 w-0.5 shrink-0 rounded-full bg-primary" aria-hidden />}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {pane.tabs.map((t) => {
          const isActive = t.id === pane.activeTabId;
          const issue = t.view === "issue" ? (issues ?? []).find((i) => i.id === t.issueId) : undefined;
          const label = t.view === "issue" ? issue?.identifier ?? "Issue" : META[t.view].label;
          const icon = t.view === "issue" ? <FileText className="size-3.5" /> : META[t.view].icon;
          return (
            <div
              key={t.id}
              draggable
              onDragStart={(e) => onDragStart(e, t.id)}
              onClick={() => selectTab(t.id)}
              onContextMenu={(e) => openMenu(e, t.id)}
              className={`group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                isActive ? "bg-card text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              <span className="text-muted-foreground">{icon}</span>
              <span className="max-w-[12rem] truncate">{label}</span>
              {canClose && (
                <button
                  type="button"
                  aria-label="Close tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(t.id);
                  }}
                  className="ml-1 cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          aria-label="New tab"
          onClick={() => addTabIn(pane.id)}
          className="ml-1 shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
      </div>
      {showClock && (
        <div className="shrink-0">
          <DualClock compact />
        </div>
      )}
      {menu && <TabContextMenu tabId={menu.tabId} isSplit={isSplit} canClose={canClose} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  );
}
