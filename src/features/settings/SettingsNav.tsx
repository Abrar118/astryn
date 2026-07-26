import { SETTINGS_GROUPS, type SettingsSection } from "./settingsSection";

/** Left rail: grouped section list, Linear-style. */
export function SettingsNav({
  active,
  onSelect,
}: {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}) {
  return (
    <nav
      aria-label="Settings sections"
      className="flex w-52 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border/60 bg-sidebar/40 px-3 pb-28 pt-10"
    >
      <span className="px-2 text-sm font-semibold tracking-tight text-foreground">Settings</span>
      {SETTINGS_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <span className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            {group.label}
          </span>
          {group.items.map((item) => {
            const selected = item.id === active;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={selected ? "page" : undefined}
                onClick={() => onSelect(item.id)}
                className={`relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-semibold transition-colors ${
                  selected
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                }`}
              >
                {selected && (
                  <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" aria-hidden />
                )}
                <Icon className={`size-4 shrink-0 ${selected ? "text-primary" : "text-muted-foreground/70"}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
