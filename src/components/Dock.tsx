import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { ChevronUp, Plus, RefreshCw } from "lucide-react";
import { useWorkspace, type ViewKind } from "@/lib/tabs";
import { VIEW_META, dockEntries, visibleViews, useModules, type DockGroup } from "@/lib/modules";

type NavView = Exclude<ViewKind, "issue">;

function Tooltip({ children }: { children: ReactNode }) {
  return (
    <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-foreground opacity-0 shadow-[0_4px_16px_var(--overlay-shadow)] transition-opacity duration-150 group-hover:opacity-100">
      {children}
    </span>
  );
}

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
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
      }`}
    >
      {children}
      <Tooltip>{label}</Tooltip>
    </button>
  );
}

/** A split dock button: the icon opens the group's default screen, the
 *  up-chevron opens a drop-up with every shown member. */
function DockGroupButton({
  group,
  views,
  activeView,
  open,
  onToggle,
  onOpenView,
  onContextMenu,
}: {
  group: DockGroup;
  views: NavView[];
  activeView: ViewKind;
  open: boolean;
  onToggle: (open: boolean) => void;
  onOpenView: (view: NavView) => void;
  onContextMenu: (view: NavView, e: MouseEvent) => void;
}) {
  const chevronRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const defaultView = views[0];
  const current = views.includes(activeView as NavView) ? (activeView as NavView) : null;
  const GroupIcon = group.icon;

  useEffect(() => {
    if (open) itemRefs.current[Math.max(0, current ? views.indexOf(current) : 0)]?.focus();
  }, [open, current, views]);

  const close = (refocus: boolean) => {
    onToggle(false);
    if (refocus) chevronRef.current?.focus();
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = itemRefs.current.findIndex((el) => el === document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      itemRefs.current[(index + step + views.length) % views.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      itemRefs.current[e.key === "Home" ? 0 : views.length - 1]?.focus();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  return (
    <div className="relative flex items-center" onClick={(e) => e.stopPropagation()}>
      <div
        className={`flex items-center rounded-xl transition-colors ${
          current ? "bg-primary/20" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => onOpenView(current ?? defaultView)}
          onContextMenu={(e) => onContextMenu(current ?? defaultView, e)}
          aria-label={`${group.label}: ${VIEW_META[current ?? defaultView].label}`}
          className={`group relative flex h-11 w-10 cursor-pointer items-center justify-center rounded-l-xl transition-colors ${
            current ? "text-primary" : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          }`}
        >
          <GroupIcon className="size-5" />
          <Tooltip>
            {group.label} · {VIEW_META[current ?? defaultView].label}
          </Tooltip>
        </button>
        <button
          ref={chevronRef}
          type="button"
          onClick={() => onToggle(!open)}
          aria-label={`More ${group.label} screens`}
          aria-haspopup="menu"
          aria-expanded={open}
          className={`flex h-11 w-5 cursor-pointer items-center justify-center rounded-r-xl transition-colors ${
            open ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          }`}
        >
          <ChevronUp className={`size-3.5 transition-transform duration-150 ${open ? "" : "translate-y-px"}`} />
        </button>
      </div>

      {open && (
        <div
          role="menu"
          aria-label={group.label}
          onKeyDown={onMenuKey}
          className="absolute bottom-full left-0 mb-2 min-w-48 rounded-lg border border-border bg-popover p-1 shadow-[0_4px_16px_var(--overlay-shadow)]"
        >
          <p className="px-2.5 pt-1 pb-1.5 text-[11px] lowercase text-muted-foreground">{group.label}</p>
          {views.map((view, i) => {
            const { label, icon: Icon } = VIEW_META[view];
            const selected = view === current;
            return (
              <button
                key={view}
                ref={(el) => { itemRefs.current[i] = el; }}
                type="button"
                role="menuitem"
                aria-current={selected ? "page" : undefined}
                onClick={() => {
                  onOpenView(view);
                  close(false);
                }}
                onContextMenu={(e) => onContextMenu(view, e)}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
              >
                <Icon className="size-4 text-muted-foreground" />
                <span className="flex-1">{label}</span>
                {i === 0 && <span className="text-[11px] text-muted-foreground">default</span>}
                {selected && <span aria-hidden className="dash-lamp dash-lamp-lit size-1.5 bg-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Dock({ isSyncing, refresh }: { isSyncing: boolean; refresh: () => void }) {
  const { active, setActiveView, addTab } = useWorkspace();
  const { isActive, disabledScreens } = useModules();
  const [menu, setMenu] = useState<{ view: NavView; x: number; y: number } | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  useEffect(() => {
    if (!menu && !openGroup) return;
    const close = () => {
      setMenu(null);
      setOpenGroup(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    // Any click elsewhere (including other dock buttons) dismisses open menus.
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, openGroup]);

  const openContextMenu = (view: NavView, e: MouseEvent) => {
    e.preventDefault();
    setOpenGroup(null);
    setMenu({ view, x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-sidebar-border bg-sidebar p-1.5">
          {dockEntries(visibleViews(isActive, disabledScreens)).map((entry) => {
            if (entry.kind === "group") {
              return (
                <DockGroupButton
                  key={entry.group.id}
                  group={entry.group}
                  views={entry.views}
                  activeView={active.view}
                  open={openGroup === entry.group.id}
                  onToggle={(open) => {
                    setMenu(null);
                    setOpenGroup(open ? entry.group.id : null);
                  }}
                  onOpenView={(view) => {
                    setOpenGroup(null);
                    setActiveView(view);
                  }}
                  onContextMenu={openContextMenu}
                />
              );
            }
            const { view } = entry;
            const { label, icon: Icon } = VIEW_META[view];
            return (
              <DockButton
                key={view}
                label={label}
                active={active.view === view}
                onClick={() => setActiveView(view)}
                onContextMenu={(e) => openContextMenu(view, e)}
              >
                <Icon className="size-5" />
              </DockButton>
            );
          })}
          <div className="mx-1 h-6 w-px bg-sidebar-border" />
          <DockButton label={isSyncing ? "Syncing…" : "Refresh"} active={false} onClick={refresh}>
            <RefreshCw className={`size-5 ${isSyncing ? "animate-spin" : ""}`} />
          </DockButton>
        </div>
      </div>

      {menu && (
        <div
          className="fixed z-40 min-w-44 -translate-y-full rounded-lg border border-border bg-popover p-1 shadow-[0_4px_16px_var(--overlay-shadow)]"
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
