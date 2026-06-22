import { ChevronDown } from "lucide-react";
import { Avatar } from "./Avatar";
import { Popover, PopoverItem } from "./Popover";
import type { User } from "@/lib/commands";

/**
 * Assignee dropdown with avatars (a native <select> can't render images).
 * `value === null` selects the empty option (`emptyLabel`). Renders its menu in
 * a portal so it is never clipped by a scrolling container.
 */
export function AssigneeSelect({
  value,
  onChange,
  users,
  meId,
  emptyLabel,
  disabled,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  users: User[];
  meId?: string;
  emptyLabel: string;
  disabled?: boolean;
}) {
  const selected = value ? users.find((u) => u.id === value) : undefined;

  return (
    <Popover
      disabled={disabled}
      align="start"
      buttonClassName="flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-secondary/40 py-1.5 pl-2 pr-2 text-xs font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      panelClassName="max-h-72 w-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-2xl"
      button={
        <>
          {selected && <Avatar name={selected.name} src={selected.avatarUrl} />}
          <span className="max-w-[10rem] truncate">{selected ? selected.name : emptyLabel}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </>
      }
    >
      {(close) => (
        <>
          <PopoverItem label={<span className="text-muted-foreground">{emptyLabel}</span>} active={!value} onClick={() => (onChange(null), close())} />
          {users.map((u) => (
            <PopoverItem
              key={u.id}
              icon={<Avatar name={u.name} src={u.avatarUrl} size={16} />}
              label={
                <span className="flex items-center gap-1">
                  <span className="truncate">{u.name}</span>
                  {u.id === meId && <span className="text-[10px] text-muted-foreground">me</span>}
                </span>
              }
              active={value === u.id}
              onClick={() => (onChange(u.id), close())}
            />
          ))}
        </>
      )}
    </Popover>
  );
}
