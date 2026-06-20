import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Calendar, List, Plus, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { useWorkspace, type ViewKind } from "@/lib/tabs";

function DockButton({
  label,
  active,
  onClick,
  onContextMenu,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-label={label}
      className={`group relative flex size-11 cursor-pointer items-center justify-center rounded-xl transition-colors ${
        active
          ? "bg-primary/20 text-primary"
          : "text-muted-foreground hover:bg-white/10 hover:text-foreground"
      }`}
    >
      {children}
      <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
        {label}
      </span>
    </button>
  );
}

const NAV: { view: Exclude<ViewKind, "issue">; label: string; icon: ReactNode }[] = [
  { view: "calendar", label: "Calendar", icon: <Calendar className="size-5" /> },
  { view: "list", label: "Issues", icon: <List className="size-5" /> },
  { view: "settings", label: "Settings", icon: <SettingsIcon className="size-5" /> },
];

const META: Record<Exclude<ViewKind, "issue">, string> = { calendar: "Calendar", list: "Issues", settings: "Settings" };

export function Dock({ isSyncing, refresh }: { isSyncing: boolean; refresh: () => void }) {
  const { active, setActiveView, addTab } = useWorkspace();
  const [menu, setMenu] = useState<{ view: Exclude<ViewKind, "issue">; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    // Capture so any click anywhere (including dock buttons) dismisses first.
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-white/10 bg-sidebar/90 p-1.5 shadow-2xl shadow-black/50 ring-1 ring-primary/15 backdrop-blur-md">
          {NAV.map((n) => (
            <DockButton
              key={n.view}
              label={n.label}
              active={active.view === n.view}
              onClick={() => setActiveView(n.view)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ view: n.view, x: e.clientX, y: e.clientY });
              }}
            >
              {n.icon}
            </DockButton>
          ))}
          <div className="mx-1 h-6 w-px bg-border" />
          <DockButton label={isSyncing ? "Syncing…" : "Refresh"} active={false} onClick={refresh}>
            <RefreshCw className={`size-5 ${isSyncing ? "animate-spin" : ""}`} />
          </DockButton>
        </div>
      </div>

      {menu && (
        <div
          className="fixed z-40 min-w-44 -translate-y-full rounded-lg border border-border bg-popover p-1 shadow-2xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              addTab(menu.view);
              setMenu(null);
            }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
          >
            <Plus className="size-3.5 text-muted-foreground" />
            Open {META[menu.view]} in new tab
          </button>
        </div>
      )}
    </>
  );
}
