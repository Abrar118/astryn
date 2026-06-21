import { useMemo, useState } from "react";
import { gooeyToast } from "goey-toast";
import { CalendarClock, Check, SignalHigh, User as UserIcon, X } from "lucide-react";
import { useUsers, useUpdateIssue } from "@/lib/queries";
import { dhakaToday } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { UpdateIssuePatch } from "@/lib/commands";
import { PRIORITIES, STATE_RANK, DUE_PRESETS } from "@/features/issues/issueFields";
import { bulkStatusTeamId, type GraphIndex } from "./graphModel";

type MenuKey = "status" | "assignee" | "priority" | "due";

export function BulkActionBar({
  selectedIds,
  index,
  onClear,
}: {
  selectedIds: string[];
  index: GraphIndex;
  onClear: () => void;
}) {
  const { data: users } = useUsers();
  const update = useUpdateIssue();
  const [open, setOpen] = useState<MenuKey | null>(null);

  const teamId = bulkStatusTeamId(selectedIds, index);
  const teamStates = useMemo(() => {
    if (!teamId) return [];
    const seen = new Map<string, { id: string; name: string; type: string; color: string }>();
    for (const i of index.byId.values()) {
      if (i.teamId === teamId && i.stateId && i.stateName) {
        seen.set(i.stateId, { id: i.stateId, name: i.stateName, type: i.stateType, color: i.stateColor });
      }
    }
    return [...seen.values()].sort((a, b) => (STATE_RANK[a.type] ?? 9) - (STATE_RANK[b.type] ?? 9));
  }, [teamId, index]);

  const apply = async (patch: UpdateIssuePatch, label: string) => {
    setOpen(null);
    const n = selectedIds.length;
    const results = await Promise.allSettled(selectedIds.map((id) => update.mutateAsync({ id, patch })));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      gooeyToast.error(`${label} · ${failed} of ${n} failed`);
    } else {
      gooeyToast.success(`${label} · ${n} issue${n !== 1 ? "s" : ""}`);
    }
  };

  const toggle = (k: MenuKey) => setOpen((cur) => (cur === k ? null : k));

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-card/95 px-2 py-1 text-xs shadow-xl backdrop-blur">
      <span className="px-1 font-medium text-foreground">{selectedIds.length} selected</span>
      <span className="mx-0.5 h-4 w-px bg-border" />

      <BarButton icon={<Check className="size-3.5" />} label="Status" disabled={!teamId} title={teamId ? undefined : "Select issues from one team to set status"} onClick={() => toggle("status")} open={open === "status"}>
        {teamStates.length === 0 ? (
          <Empty>No states</Empty>
        ) : (
          teamStates.map((s) => (
            <Item key={s.id} onClick={() => apply({ stateId: s.id }, s.name)}>
              <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.name}
            </Item>
          ))
        )}
      </BarButton>

      <BarButton icon={<UserIcon className="size-3.5" />} label="Assignee" onClick={() => toggle("assignee")} open={open === "assignee"}>
        <Item onClick={() => apply({ assigneeId: null }, "Unassigned")}>
          <span className="size-3.5 rounded-full border border-dashed border-border" />
          Unassigned
        </Item>
        {(users ?? []).map((u) => (
          <Item key={u.id} onClick={() => apply({ assigneeId: u.id }, u.name)}>
            <span className="size-3.5 rounded-full bg-muted" />
            {u.name}
          </Item>
        ))}
      </BarButton>

      <BarButton icon={<SignalHigh className="size-3.5" />} label="Priority" onClick={() => toggle("priority")} open={open === "priority"}>
        {PRIORITIES.map((p) => (
          <Item key={p.value} onClick={() => apply({ priority: p.value }, p.label)}>
            <span className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />
            {p.label}
          </Item>
        ))}
      </BarButton>

      <BarButton icon={<CalendarClock className="size-3.5" />} label="Due" onClick={() => toggle("due")} open={open === "due"}>
        {DUE_PRESETS.map((p) => (
          <Item key={p.label} onClick={() => apply({ dueDate: p.resolve(dhakaToday()) }, p.label)}>
            {p.label}
          </Item>
        ))}
      </BarButton>

      <span className="mx-0.5 h-4 w-px bg-border" />
      <button
        type="button"
        aria-label="Clear selection"
        onClick={onClear}
        className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function BarButton({
  icon,
  label,
  open,
  disabled,
  title,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  open: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        title={title}
        onClick={onClick}
        className={cn(
          "flex items-center gap-1 rounded px-1.5 py-1 text-muted-foreground transition-colors",
          disabled ? "cursor-not-allowed opacity-40" : "hover:bg-accent hover:text-foreground",
          open && "bg-accent text-foreground",
        )}
      >
        {icon}
        {label}
      </button>
      {open && !disabled && (
        <div className="absolute bottom-full left-0 mb-1 max-h-64 w-44 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-2xl">
          {children}
        </div>
      )}
    </div>
  );
}

function Item({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-accent"
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 py-1.5 text-[12px] text-muted-foreground">{children}</div>;
}
