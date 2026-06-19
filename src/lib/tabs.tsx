import { createContext, useContext, useState, type ReactNode } from "react";

export type ViewKind = "calendar" | "list" | "settings";
export type Tab = { id: string; view: ViewKind };

type Ctx = {
  tabs: Tab[];
  active: Tab;
  setActiveView: (view: ViewKind) => void;
  addTab: (view?: ViewKind) => void;
  closeTab: (id: string) => void;
  selectTab: (id: string) => void;
};

const WorkspaceCtx = createContext<Ctx | null>(null);

let seq = 1;
const nextId = () => `tab-${seq++}`;

/**
 * Browser-style tabbed workspace. Each tab holds one view (calendar / list /
 * settings); the dock switches the active tab's view, "+" opens a new tab.
 * State is per-session (resets on reload) — a first cut.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<Tab[]>([{ id: "tab-0", view: "calendar" }]);
  const [activeId, setActiveId] = useState("tab-0");
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  const setActiveView = (view: ViewKind) =>
    setTabs((ts) => ts.map((t) => (t.id === active.id ? { ...t, view } : t)));

  const addTab = (view: ViewKind = "calendar") => {
    const id = nextId();
    setTabs((ts) => [...ts, { id, view }]);
    setActiveId(id);
  };

  const closeTab = (id: string) => {
    if (tabs.length === 1) return; // always keep one tab open
    const idx = tabs.findIndex((t) => t.id === id);
    const remaining = tabs.filter((t) => t.id !== id);
    setTabs(remaining);
    if (id === activeId) {
      setActiveId((remaining[idx] ?? remaining[remaining.length - 1]).id);
    }
  };

  const selectTab = (id: string) => setActiveId(id);

  return (
    <WorkspaceCtx.Provider
      value={{ tabs, active, setActiveView, addTab, closeTab, selectTab }}
    >
      {children}
    </WorkspaceCtx.Provider>
  );
}

export function useWorkspace(): Ctx {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
