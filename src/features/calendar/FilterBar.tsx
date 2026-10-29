import { useId, useMemo, type ChangeEventHandler, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useTaskFilterOptions, useTaskUsers, useViewer } from "@/lib/taskQueries";
import { ME, type TaskFilters } from "@/lib/tracker";
import type { User } from "@/lib/commands";
import { AssigneeSelect } from "@/components/AssigneeSelect";

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: ChangeEventHandler<HTMLSelectElement>;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={onChange}
        className="dash-control h-7 cursor-pointer appearance-none rounded-md border border-border bg-secondary/40 pl-2.5 pr-7 text-xs font-medium text-foreground transition-colors hover:bg-accent"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

/** Assignee choices: one "me" entry (your tasks in every tracker), then everyone else. */
export function assigneeChoices(users: User[], viewerIds: readonly string[], viewerName: string | null): User[] {
  const me = users.find((u) => viewerIds.includes(u.id));
  return [
    { id: ME, name: viewerName ?? me?.name ?? "Me", avatarUrl: me?.avatarUrl ?? null },
    ...users.filter((u) => !viewerIds.includes(u.id)),
  ];
}

export function FilterBar({
  filters,
  colorBy,
  onFilters,
  onColorBy,
}: {
  filters: TaskFilters;
  colorBy: "state" | "priority";
  onFilters: (f: TaskFilters) => void;
  onColorBy: (c: "state" | "priority") => void;
}) {
  const { data } = useTaskFilterOptions();
  const { data: users } = useTaskUsers();
  const viewer = useViewer();
  const colorById = useId();
  const choices = useMemo(
    () => assigneeChoices(users ?? [], viewer.viewerIds, viewer.name),
    [users, viewer.viewerIds, viewer.name],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <AssigneeSelect
        value={filters.assigneeId ?? null}
        onChange={(id) => onFilters({ ...filters, assigneeId: id ?? undefined })}
        users={choices}
        meId={ME}
        emptyLabel="All assignees"
      />

      <Select
        label="Team"
        value={filters.teamId ?? "__all"}
        onChange={(e) =>
          onFilters({ ...filters, teamId: e.target.value === "__all" ? undefined : e.target.value })
        }
      >
        <option value="__all">All teams</option>
        {data?.teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.key}
          </option>
        ))}
      </Select>

      <Select
        label="Project"
        value={filters.projectId ?? "__all"}
        onChange={(e) =>
          onFilters({ ...filters, projectId: e.target.value === "__all" ? undefined : e.target.value })
        }
      >
        <option value="__all">All projects</option>
        {data?.projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>

      <div className="ml-auto flex items-center gap-2">
        <span id={colorById} className="text-[12px] text-muted-foreground">color by</span>
        <div role="group" aria-labelledby={colorById} className="face-segment">
          {(["state", "priority"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onColorBy(c)}
              aria-pressed={colorBy === c}
              className="face-segment-item lowercase"
            >
              {c}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
