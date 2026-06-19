import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Avatar } from "./Avatar";
import type { User } from "@/lib/commands";

/**
 * Custom assignee dropdown that shows avatars (a native <select> can't render
 * images). `value === null` selects the empty option (`emptyLabel`).
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = value ? users.find((u) => u.id === value) : undefined;

  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-secondary/40 py-1.5 pl-2 pr-2 text-xs font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        {selected && <Avatar name={selected.name} src={selected.avatarUrl} />}
        <span className="max-w-[10rem] truncate">{selected ? selected.name : emptyLabel}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-xl">
          <button
            type="button"
            onClick={() => pick(null)}
            className="flex w-full cursor-pointer items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {emptyLabel}
          </button>
          {users.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => pick(u.id)}
              className={`flex w-full cursor-pointer items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent ${
                value === u.id ? "bg-accent/60" : ""
              }`}
            >
              <Avatar name={u.name} src={u.avatarUrl} />
              <span className="truncate text-foreground">{u.name}</span>
              {u.id === meId && (
                <span className="ml-auto text-[10px] text-muted-foreground">me</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
