import type { ChangeEventHandler, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useFilterOptions, useUsers } from "@/lib/queries";
import type { IssueFilters } from "@/lib/commands";

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: ChangeEventHandler<HTMLSelectElement>;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={onChange}
        className="cursor-pointer appearance-none rounded-md border border-border bg-secondary/40 py-1.5 pl-2.5 pr-7 text-xs font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export function FilterBar({
  filters,
  colorBy,
  meId,
  onFilters,
  onColorBy,
}: {
  filters: IssueFilters;
  colorBy: "state" | "priority";
  meId?: string;
  onFilters: (f: IssueFilters) => void;
  onColorBy: (c: "state" | "priority") => void;
}) {
  const { data } = useFilterOptions();
  const { data: users } = useUsers();

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Select
        value={filters.assigneeId ?? "__all"}
        onChange={(e) =>
          onFilters({ ...filters, assigneeId: e.target.value === "__all" ? undefined : e.target.value })
        }
      >
        <option value="__all">All assignees</option>
        {users?.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
            {u.id === meId ? " (me)" : ""}
          </option>
        ))}
      </Select>

      <Select
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

      <div className="ml-auto inline-flex items-center rounded-md border border-border bg-secondary/40 p-0.5 text-xs">
        {(["state", "priority"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onColorBy(c)}
            aria-pressed={colorBy === c}
            className={`cursor-pointer rounded-[5px] px-2.5 py-1 font-medium capitalize transition-colors ${
              colorBy === c ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}
