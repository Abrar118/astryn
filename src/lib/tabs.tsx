import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

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

// ── Persistence ────────────────────────────────────────────────────────────────
// The open tabs + active tab survive reloads via localStorage. This is UI state
// only (which views are open) — it never touches issue data or secrets.
type Persisted = { tabs: Tab[]; activeId: string; seq: number };
const STORAGE_KEY = "astryn.workspace";
const FALLBACK: Persisted = { tabs: [{ id: "tab-0", view: "calendar" }], activeId: "tab-0", seq: 1 };
const VIEWS: ViewKind[] = ["calendar", "list", "settings"];

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return FALLBACK;
    const p = JSON.parse(raw) as Partial<Persisted>;
    const tabs = Array.isArray(p.tabs)
      ? p.tabs.filter((t): t is Tab => !!t && typeof t.id === "string" && VIEWS.includes(t.view))
      : [];
    if (tabs.length === 0) return FALLBACK;
    const activeId = tabs.some((t) => t.id === p.activeId) ? (p.activeId as string) : tabs[0].id;
    const seq = typeof p.seq === "number" ? p.seq : tabs.length;
    return { tabs, activeId, seq };
  } catch {
    return FALLBACK;
  }
}

/**
 * Browser-style tabbed workspace. Each tab holds one view (calendar / list /
 * settings); the dock switches the active tab's view, "+" opens a new tab.
 * Open tabs and the active tab persist across reloads (localStorage).
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const initial = useRef<Persisted | null>(null);
  if (!initial.current) initial.current = load();

  const [tabs, setTabs] = useState<Tab[]>(initial.current.tabs);
  const [activeId, setActiveId] = useState(initial.current.activeId);
  const seq = useRef(initial.current.seq);
  const nextId = () => `tab-${seq.current++}`;
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId, seq: seq.current }));
    } catch {
      // Storage unavailable / quota — fall back to in-memory state silently.
    }
  }, [tabs, activeId]);

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
