import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useModules, viewActive } from "./modules";
import {
  parsePersisted, addTabIn as addTabInReducer, closeTabIn, selectTabIn,
  splitTabRight as splitTabRightReducer, moveTabToOtherPane as moveTabReducer, moveTab as moveTabAtReducer,
  swapPanes as swapPanesReducer, openIssueTabAcross, openIssueInRightSplit as openRightReducer,
  openDocTabAcross, openDocInRightSplit as openDocRightReducer, closeTabsWhere,
  type WorkspaceState, type Pane, type Tab, type ViewKind,
} from "./paneModel";

export type { ViewKind, Tab, Pane } from "./paneModel";

type Ctx = {
  panes: Pane[];
  focusedPaneId: string;
  ratio: number;
  tabs: Tab[];
  active: Tab;
  setActiveView: (view: ViewKind) => void;
  addTab: (view?: ViewKind) => void;
  addTabIn: (paneId: string, view?: ViewKind) => void;
  closeTab: (id: string) => void;
  selectTab: (id: string) => void;
  openIssueTab: (issueId: string) => void;
  openIssueInRightSplit: (issueId: string) => void;
  openDocTab: (sourceId: string, docPath: string) => void;
  openDocToSide: (sourceId: string, docPath: string) => void;
  splitTabRight: (tabId: string) => void;
  moveTabToOtherPane: (tabId: string) => void;
  moveTab: (tabId: string, targetPaneId: string, targetIndex: number) => void;
  swapPanes: () => void;
  focusPane: (paneId: string) => void;
  setRatio: (n: number) => void;
};

const WorkspaceCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = "astryn.workspace";

function load(): WorkspaceState {
  try {
    return parsePersisted(localStorage.getItem(STORAGE_KEY));
  } catch {
    return parsePersisted(null);
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const initial = useRef<WorkspaceState | null>(null);
  if (!initial.current) initial.current = load();
  const [state, setState] = useState<WorkspaceState>(initial.current);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage unavailable / quota — keep in-memory state silently.
    }
  }, [state]);

  // Tabs of a module or screen that is off (or turned off later) close; nothing is dropped while modules load.
  const { data: modulesData, isActive, disabledScreens } = useModules();
  const shown = (view: ViewKind) => viewActive(view, isActive, disabledScreens);
  useEffect(() => {
    if (!modulesData) return;
    setState((s) => closeTabsWhere(s, (t) => !shown(t.view)));
    // shown is rebuilt every render; modulesData is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modulesData]);
  // Every opener goes through these, so no shortcut, link or button can open a hidden view.
  const newTabView = (view: ViewKind): ViewKind => (shown(view) ? view : "dashboard");
  const ifShown = (view: ViewKind, open: () => void) => {
    if (shown(view)) open();
  };

  const focusedPane = state.panes.find((p) => p.id === state.focusedPaneId) ?? state.panes[0];
  const active = focusedPane.tabs.find((t) => t.id === focusedPane.activeTabId) ?? focusedPane.tabs[0];

  const setActiveView = (view: ViewKind) =>
    ifShown(view, () =>
      setState((s) => {
        const fp = s.panes.find((p) => p.id === s.focusedPaneId) ?? s.panes[0];
        const panes = s.panes.map((p) =>
          p.id === fp.id
            ? { ...p, tabs: p.tabs.map((t) => (t.id === fp.activeTabId ? { id: t.id, view } : t)) }
            : p,
        );
        return { ...s, panes };
      }),
    );

  const value: Ctx = {
    panes: state.panes,
    focusedPaneId: state.focusedPaneId,
    ratio: state.ratio,
    tabs: focusedPane.tabs,
    active,
    setActiveView,
    addTab: (view: ViewKind = "calendar") => setState((s) => addTabInReducer(s, s.focusedPaneId, newTabView(view))),
    addTabIn: (paneId, view = "calendar") => setState((s) => addTabInReducer(s, paneId, newTabView(view))),
    closeTab: (id) => setState((s) => closeTabIn(s, id)),
    selectTab: (id) => setState((s) => selectTabIn(s, id)),
    openIssueTab: (issueId) => ifShown("issue", () => setState((s) => openIssueTabAcross(s, issueId))),
    openIssueInRightSplit: (issueId) => ifShown("issue", () => setState((s) => openRightReducer(s, issueId))),
    openDocTab: (sourceId, docPath) => ifShown("docs", () => setState((s) => openDocTabAcross(s, sourceId, docPath))),
    openDocToSide: (sourceId, docPath) => ifShown("docs", () => setState((s) => openDocRightReducer(s, sourceId, docPath))),
    splitTabRight: (tabId) => setState((s) => splitTabRightReducer(s, tabId)),
    moveTabToOtherPane: (tabId) => setState((s) => moveTabReducer(s, tabId)),
    moveTab: (tabId, targetPaneId, targetIndex) => setState((s) => moveTabAtReducer(s, tabId, targetPaneId, targetIndex)),
    swapPanes: () => setState((s) => swapPanesReducer(s)),
    focusPane: (paneId) => setState((s) => (s.focusedPaneId === paneId ? s : { ...s, focusedPaneId: paneId })),
    setRatio: (n) => setState((s) => (s.ratio === n ? s : { ...s, ratio: n })),
  };

  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export function useWorkspace(): Ctx {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
