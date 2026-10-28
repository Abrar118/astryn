import { useState } from "react";
import { ArrowDown, ArrowUp, CornerDownRight } from "lucide-react";
import { StatusIcon } from "@/features/drawer/issueGlyphs";
import { dueLabel } from "@/features/issues/IssueRow";
import { isOverdue } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { sortTasks, type SortDir, type SortKey } from "../localTaskModel";
import { PriorityDot, priorityLabel } from "../LocalFields";
import type { ViewProps } from "./ListView";

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: "identifier", label: "ID", className: "w-24" },
  { key: "title", label: "Task", className: "min-w-64" },
  { key: "status", label: "Status", className: "w-40" },
  { key: "priority", label: "Priority", className: "w-32" },
  { key: "start", label: "Start", className: "w-28" },
  { key: "due", label: "Due", className: "w-28" },
  { key: "estimate", label: "Estimate", className: "w-24" },
  { key: "sprint", label: "Sprint", className: "w-36" },
];

/** Every task (subtasks included) as sortable rows; a row opens the drawer. */
export function TableView(props: ViewProps) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "identifier", dir: "asc" });
  const rows = sortTasks(props.tasks, sort.key, sort.dir);
  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  if (rows.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">No tasks match. Switch to List to add one.</p>;
  }
  return (
    <div className="h-full overflow-auto pb-24">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b border-border">
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                className={cn("px-3 py-2 text-left text-[11px] font-medium text-muted-foreground", c.className)}
              >
                <button
                  type="button"
                  onClick={() => toggle(c.key)}
                  className="flex cursor-pointer items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {c.label}
                  {sort.key === c.key &&
                    (sort.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr
              key={t.id}
              onClick={() => props.onOpen(t.id)}
              onContextMenu={(e) => props.onMenu(e, t.id)}
              className="cursor-pointer border-b border-border/40 hover:bg-accent/50"
            >
              <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{t.identifier}</td>
              <td className="max-w-0 px-3 py-1.5">
                <button
                  type="button"
                  onClick={(e) => (e.stopPropagation(), props.onOpen(t.id))}
                  className="block w-full cursor-pointer truncate text-left text-foreground focus-visible:outline-none focus-visible:underline"
                >
                  {t.parentId && <CornerDownRight aria-label="Subtask" className="mr-1 inline size-3 text-muted-foreground" />}
                  {t.title}
                </button>
              </td>
              <td className="px-3 py-1.5">
                <span className="flex items-center gap-1.5">
                  <StatusIcon type={t.stateType} color={t.stateColor} />
                  <span className="truncate">{t.stateName}</span>
                </span>
              </td>
              <td className="px-3 py-1.5">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <PriorityDot value={t.priority} />
                  {priorityLabel(t.priority)}
                </span>
              </td>
              <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{t.startDate ? dueLabel(t.startDate, props.today) : "—"}</td>
              <td
                className={cn(
                  "px-3 py-1.5 tabular-nums",
                  isOverdue(t.dueDate, t.stateType, props.today) ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {t.dueDate ? dueLabel(t.dueDate, props.today) : "—"}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{t.estimate ?? "—"}</td>
              <td className="truncate px-3 py-1.5 text-muted-foreground">{t.cycleName ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
