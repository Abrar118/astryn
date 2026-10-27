import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { useWorkspace, type ViewKind } from "@/lib/tabs";
import { VIEW_META, visibleViews, useModules } from "@/lib/modules";

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
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {children}
      <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
        {label}
      </span>
    </button>
  );
}

export function Dock({ isSyncing, refresh }: { isSyncing: boolean; refresh: () => void }) {
  const { active, setActiveView, addTab } = useWorkspace();
  const { isActive } = useModules();
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
        <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-border bg-sidebar p-1.5 shadow-2xl">
          {visibleViews(isActive).map((view) => {
            const { label, icon: Icon } = VIEW_META[view];
            return (
              <DockButton
                key={view}
                label={label}
                active={active.view === view}
                onClick={() => setActiveView(view)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ view, x: e.clientX, y: e.clientY });
                }}
              >
                <Icon className="size-5" />
              </DockButton>
            );
          })}
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
            Open {VIEW_META[menu.view].label} in new tab
          </button>
        </div>
      )}
    </>
  );
}
