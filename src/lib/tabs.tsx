import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  parsePersisted, addTabIn as addTabInReducer, closeTabIn, selectTabIn,
  splitTabRight as splitTabRightReducer, moveTabToOtherPane as moveTabReducer, moveTab as moveTabAtReducer,
  swapPanes as swapPanesReducer, openIssueTabAcross, openIssueInRightSplit as openRightReducer,
  openDocTabAcross, openDocInRightSplit as openDocRightReducer,
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
  openDocTab: (docPath: string) => void;
  openDocToSide: (docPath: string) => void;
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

  const focusedPane = state.panes.find((p) => p.id === state.focusedPaneId) ?? state.panes[0];
  const active = focusedPane.tabs.find((t) => t.id === focusedPane.activeTabId) ?? focusedPane.tabs[0];

  const setActiveView = (view: ViewKind) =>
    setState((s) => {
      const fp = s.panes.find((p) => p.id === s.focusedPaneId) ?? s.panes[0];
      const panes = s.panes.map((p) =>
        p.id === fp.id
          ? { ...p, tabs: p.tabs.map((t) => (t.id === fp.activeTabId ? { id: t.id, view } : t)) }
          : p,
      );
      return { ...s, panes };
    });

  const value: Ctx = {
    panes: state.panes,
    focusedPaneId: state.focusedPaneId,
    ratio: state.ratio,
    tabs: focusedPane.tabs,
    active,
    setActiveView,
    addTab: (view: ViewKind = "calendar") => setState((s) => addTabInReducer(s, s.focusedPaneId, view)),
    addTabIn: (paneId, view = "calendar") => setState((s) => addTabInReducer(s, paneId, view)),
    closeTab: (id) => setState((s) => closeTabIn(s, id)),
    selectTab: (id) => setState((s) => selectTabIn(s, id)),
    openIssueTab: (issueId) => setState((s) => openIssueTabAcross(s, issueId)),
    openIssueInRightSplit: (issueId) => setState((s) => openRightReducer(s, issueId)),
    openDocTab: (docPath) => setState((s) => openDocTabAcross(s, docPath)),
    openDocToSide: (docPath) => setState((s) => openDocRightReducer(s, docPath)),
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
