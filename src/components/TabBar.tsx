import type { ReactNode } from "react";
import { Calendar, List, Plus, Settings as SettingsIcon, X } from "lucide-react";
import { useWorkspace, type ViewKind } from "@/lib/tabs";

const META: Record<ViewKind, { label: string; icon: ReactNode }> = {
  calendar: { label: "Calendar", icon: <Calendar className="size-3.5" /> },
  list: { label: "Issues", icon: <List className="size-3.5" /> },
  settings: { label: "Settings", icon: <SettingsIcon className="size-3.5" /> },
};

export function TabBar() {
  const { tabs, active, selectTab, closeTab, addTab } = useWorkspace();
  return (
    <div className="flex items-center gap-1 border-b border-border bg-background px-2 py-1.5">
      {tabs.map((t) => {
        const m = META[t.view];
        const isActive = t.id === active.id;
        return (
          <div
            key={t.id}
            onClick={() => selectTab(t.id)}
            className={`group flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
              isActive
                ? "bg-card text-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
          >
            <span className="text-muted-foreground">{m.icon}</span>
            <span>{m.label}</span>
            {tabs.length > 1 && (
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
        onClick={() => addTab("calendar")}
        className="ml-1 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
