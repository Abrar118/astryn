import type { ReactNode } from "react";
import { Calendar, List, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { useWorkspace, type ViewKind } from "@/lib/tabs";

function DockButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`group relative flex size-11 cursor-pointer items-center justify-center rounded-xl transition-colors ${
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      }`}
    >
      {children}
      <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
        {label}
      </span>
    </button>
  );
}

const NAV: { view: ViewKind; label: string; icon: ReactNode }[] = [
  { view: "calendar", label: "Calendar", icon: <Calendar className="size-5" /> },
  { view: "list", label: "Issues", icon: <List className="size-5" /> },
  { view: "settings", label: "Settings", icon: <SettingsIcon className="size-5" /> },
];

export function Dock({ isSyncing, refresh }: { isSyncing: boolean; refresh: () => void }) {
  const { active, setActiveView } = useWorkspace();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-border bg-popover/90 p-1.5 shadow-2xl backdrop-blur">
        {NAV.map((n) => (
          <DockButton
            key={n.view}
            label={n.label}
            active={active.view === n.view}
            onClick={() => setActiveView(n.view)}
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
  );
}
