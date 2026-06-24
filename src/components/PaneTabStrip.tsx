import { useState, type MouseEvent, type ReactNode } from "react";
import { BookText, Calendar, CalendarRange, FileText, GitPullRequest, Inbox, List, MessageSquare, Network, Plus, Settings as SettingsIcon, X } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useWorkspace, type Pane, type Tab, type ViewKind } from "@/lib/tabs";
import { useIssues } from "@/lib/queries";
import type { IssueListItem } from "@/lib/commands";
import { StatusIcon } from "@/features/drawer/issueGlyphs";
import { DualClock } from "@/features/home/DualClock";
import { TabContextMenu } from "./TabContextMenu";

const META: Record<Exclude<ViewKind, "issue">, { label: string; icon: ReactNode }> = {
  calendar: { label: "Calendar", icon: <Calendar className="size-3.5 text-sky-400" /> },
  list: { label: "Issues", icon: <List className="size-3.5 text-indigo-400" /> },
  "this-week": { label: "Overview", icon: <CalendarRange className="size-3.5 text-violet-400" /> },
  graph: { label: "Dependencies", icon: <Network className="size-3.5 text-teal-400" /> },
  inbox: { label: "Inbox", icon: <Inbox className="size-3.5 text-amber-400" /> },
  prs: { label: "Pull Requests", icon: <GitPullRequest className="size-3.5 text-emerald-400" /> },
  slack: { label: "Slack", icon: <MessageSquare className="size-3.5 text-green-400" /> },
  docs: { label: "Docs", icon: <BookText className="size-3.5 text-rose-400" /> },
  settings: { label: "Settings", icon: <SettingsIcon className="size-3.5 text-slate-400" /> },
};

/** Display label for a tab. Issue tabs read "<ID> <title>" from the cache. */
export function tabLabel(tab: Tab, issues: Pick<IssueListItem, "id" | "identifier" | "title">[]): string {
  if (tab.view !== "issue") return META[tab.view].label;
  const issue = issues.find((i) => i.id === tab.issueId);
  if (!issue) return "Issue";
  return issue.title ? `${issue.identifier} ${issue.title}` : issue.identifier;
}

/** Tab icon. Issue tabs show the issue's workflow-state glyph (else a document). */
export function tabIcon(
  tab: Tab,
  issues: Pick<IssueListItem, "id" | "stateType" | "stateColor">[],
): ReactNode {
  if (tab.view !== "issue") return META[tab.view].icon;
  const issue = issues.find((i) => i.id === tab.issueId);
  return issue ? <StatusIcon type={issue.stateType} color={issue.stateColor} /> : <FileText className="size-3.5" />;
}

function SortableTab({
  tab,
  isActive,
  canClose,
  label,
  icon,
  onMenu,
}: {
  tab: Tab;
  isActive: boolean;
  canClose: boolean;
  label: string;
  icon: ReactNode;
  onMenu: (e: MouseEvent, tabId: string) => void;
}) {
  const { selectTab, closeTab } = useWorkspace();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : undefined }}
      {...attributes}
      {...listeners}
      onClick={() => selectTab(tab.id)}
      onContextMenu={(e) => onMenu(e, tab.id)}
      className={`group flex shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
        isActive ? "bg-card text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      }`}
    >
      <span className="flex shrink-0">{icon}</span>
      <span className="max-w-[12rem] truncate">{label}</span>
      {canClose && (
        <button
          type="button"
          aria-label="Close tab"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            closeTab(tab.id);
          }}
          className="ml-1 cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

/**
 * One pane's tab strip. Tabs are @dnd-kit sortables (drag to reorder within a
 * pane, across to the other pane, or onto the split zone); the strip's tab-list
 * region is a droppable so drops on empty space resolve to this pane. The
 * DndContext + drag resolution live in SplitLayout.
 */
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
  const { addTabIn, focusPane } = useWorkspace();
  const { data: issues } = useIssues({});
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const { setNodeRef } = useDroppable({ id: pane.id });

  const openMenu = (e: MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ tabId, x: e.clientX, y: e.clientY });
  };

  return (
    <div
      onMouseDown={() => focusPane(pane.id)}
      className={`flex items-center gap-1 border-b bg-background px-2 py-1.5 ${
        focused ? "border-b-border" : "border-b-border/60"
      }`}
    >
      {focused && <span className="mr-0.5 h-4 w-0.5 shrink-0 rounded-full bg-primary" aria-hidden />}
      <SortableContext items={pane.tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
        <div ref={setNodeRef} className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {pane.tabs.map((t) => (
            <SortableTab
              key={t.id}
              tab={t}
              isActive={t.id === pane.activeTabId}
              canClose={canClose}
              label={tabLabel(t, issues ?? [])}
              icon={tabIcon(t, issues ?? [])}
              onMenu={openMenu}
            />
          ))}
          <button
            type="button"
            aria-label="New tab"
            onClick={() => addTabIn(pane.id)}
            className="ml-1 shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </SortableContext>
      {showClock && (
        <div
          data-clock-slot
          className="ml-3 shrink-0 rounded-md border border-border/60 bg-card/60 px-2.5 py-1"
        >
          <DualClock compact />
        </div>
      )}
      {menu && <TabContextMenu tabId={menu.tabId} isSplit={isSplit} canClose={canClose} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  );
}
