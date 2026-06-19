import { useFilterOptions, useUsers } from "@/lib/queries";
import type { IssueFilters } from "@/lib/commands";

export function FilterBar({
  filters, colorBy, meId, onFilters, onColorBy,
}: {
  filters: IssueFilters;
  colorBy: "state" | "priority";
  meId?: string;
  onFilters: (f: IssueFilters) => void;
  onColorBy: (c: "state" | "priority") => void;
}) {
  const { data } = useFilterOptions();
  const { data: users } = useUsers();
  const sel = "rounded-md border bg-background px-2 py-1 text-sm";
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <select className={sel} value={filters.assigneeId ?? "__all"}
        onChange={(e) => onFilters({ ...filters, assigneeId: e.target.value === "__all" ? undefined : e.target.value })}>
        <option value="__all">All assignees</option>
        {users?.map((u) => (
          <option key={u.id} value={u.id}>{u.name}{u.id === meId ? " (me)" : ""}</option>
        ))}
      </select>
      <select className={sel} value={filters.teamId ?? "__all"}
        onChange={(e) => onFilters({ ...filters, teamId: e.target.value === "__all" ? undefined : e.target.value })}>
        <option value="__all">All teams</option>
        {data?.teams.map((t) => <option key={t.id} value={t.id}>{t.key}</option>)}
      </select>
      <select className={sel} value={filters.projectId ?? "__all"}
        onChange={(e) => onFilters({ ...filters, projectId: e.target.value === "__all" ? undefined : e.target.value })}>
        <option value="__all">All projects</option>
        {data?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select className={sel} value={colorBy} onChange={(e) => onColorBy(e.target.value as "state" | "priority")}>
        <option value="state">Color: state</option>
        <option value="priority">Color: priority</option>
      </select>
    </div>
  );
}
