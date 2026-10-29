import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { IconComponent } from "@/lib/modules";
import { getClickupStatus } from "@/lib/commands";
import { useBitbucketStatus } from "@/lib/bitbucketQueries";
import { ownerActive, useModules } from "@/lib/modules";
import { useConnectionStatus, useGithubStatus, useSlackStatus, useTeamsStatus } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { IndicatorLamp } from "@/components/IndicatorLamp";
import { connectionLamp, type ConnectionState } from "./SettingsPanel";
import { SETTINGS_GROUPS, type SettingsSection } from "./settingsSection";

const useClickupStatus = () => useQuery({ queryKey: ["clickup-status"], queryFn: getClickupStatus });

type StatusHook = () => { data?: { state: ConnectionState } | null };

/** Connection sections carry their provider's lamp in the rail. */
const STATUS_HOOKS: Partial<Record<SettingsSection, StatusHook>> = {
  linear: useConnectionStatus,
  github: useGithubStatus,
  bitbucket: useBitbucketStatus,
  slack: useSlackStatus,
  teams: useTeamsStatus,
  clickup: useClickupStatus,
};

const STATE_TEXT: Record<ConnectionState, string> = {
  connected: "connected",
  unverified: "not verified",
  not_configured: "not connected",
};

/** A connection's rail button: its lamp, with the state spelled out as the button's description. */
function ConnectionItem({ useStatus, label, ...props }: { useStatus: StatusHook } & ItemProps) {
  const state = useStatus().data?.state;
  return (
    <NavItem {...props} label={label} title={state ? `${label}: ${STATE_TEXT[state]}` : undefined}>
      <IndicatorLamp tone={connectionLamp(state)} className="ml-auto" />
    </NavItem>
  );
}

type ItemProps = {
  label: string;
  icon: IconComponent;
  tint?: string;
  selected: boolean;
  onSelect: () => void;
};

function NavItem({ label, icon: Icon, tint, selected, onSelect, title, children }: ItemProps & { title?: string; children?: ReactNode }) {
  return (
    <button
      type="button"
      aria-current={selected ? "page" : undefined}
      title={title}
      onClick={onSelect}
      className={cn(
        "dash-control flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
        selected ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon aria-hidden className={cn("size-4 shrink-0", tint || (selected ? "text-primary" : "text-muted-foreground"))} />
      <span className="truncate">{label}</span>
      {children}
    </button>
  );
}

/** Left rail: grouped section list, each connection with its status lamp. */
export function SettingsNav({
  active,
  onSelect,
}: {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}) {
  const { isActive } = useModules();
  const visibleGroups = SETTINGS_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((i) => ownerActive(i.module, isActive)),
  })).filter((group) => group.items.length > 0);
  return (
    <nav
      aria-label="Settings sections"
      className="drawer-scrollbar flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-background px-3 pb-28 pt-8"
    >
      <span className="px-2 pb-1 text-[15px] font-semibold tracking-tight text-foreground">Settings</span>
      {visibleGroups.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          {/* A one-item group named after its item needs no legend of its own. */}
          {group.label !== group.items[0].label && (
            <span className="px-2 pb-1 text-[12px] font-medium lowercase text-muted-foreground">{group.label}</span>
          )}
          {group.items.map((item) => {
            const props = {
              label: item.label,
              icon: item.icon,
              tint: item.tint,
              selected: item.id === active,
              onSelect: () => onSelect(item.id),
            };
            const useStatus = STATUS_HOOKS[item.id];
            return useStatus
              ? <ConnectionItem key={item.id} useStatus={useStatus} {...props} />
              : <NavItem key={item.id} {...props} />;
          })}
        </div>
      ))}
    </nav>
  );
}
