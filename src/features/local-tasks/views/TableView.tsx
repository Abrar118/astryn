import { useState } from "react";
import { ArrowDown, ArrowUp, CornerDownRight } from "lucide-react";
import { StatusIcon } from "@/features/drawer/issueGlyphs";
import { dueLabel } from "@/features/issues/IssueRow";
import { isOverdue } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { sortTasks, type SortDir, type SortKey } from "../localTaskModel";
import { LampMessage, PriorityLamp, priorityLabel } from "../LocalFields";
import type { ViewProps } from "./ListView";

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: "identifier", label: "id", className: "w-24" },
  { key: "title", label: "task", className: "min-w-64" },
  { key: "status", label: "status", className: "w-40" },
  { key: "priority", label: "priority", className: "w-32" },
  { key: "start", label: "start", className: "w-28" },
  { key: "due", label: "due", className: "w-28" },
  { key: "estimate", label: "estimate", className: "w-24" },
  { key: "sprint", label: "sprint", className: "w-36" },
];

const CELL = "h-9 px-3";

/** Every task (subtasks included) as sortable rows; a row opens the drawer. */
export function TableView(props: ViewProps) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "identifier", dir: "asc" });
  const rows = sortTasks(props.tasks, sort.key, sort.dir);
  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  if (rows.length === 0) {
    return <LampMessage tone="off" title="No tasks match" body="Switch to list to add one, or turn on show closed." />;
  }
  return (
    <div className="drawer-scrollbar h-full overflow-auto pb-28">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b border-border">
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                className={cn("h-10 px-1.5 text-left text-[12px] font-medium text-muted-foreground", c.className)}
              >
                <button
                  type="button"
                  onClick={() => toggle(c.key)}
                  className={cn(
                    "lt-focus flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 hover:bg-accent hover:text-foreground",
                    sort.key === c.key && "text-foreground",
                  )}
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
              className="cursor-pointer border-b border-border/70 hover:bg-accent"
            >
              <td className={cn(CELL, "whitespace-nowrap font-mono text-[12px] text-muted-foreground")}>{t.identifier}</td>
              <td className={cn(CELL, "max-w-0")}>
                <button
                  type="button"
                  onClick={(e) => (e.stopPropagation(), props.onOpen(t.id))}
                  className="lt-focus block w-full cursor-pointer truncate rounded-sm text-left text-[14px] text-foreground"
                >
                  {t.parentId && <CornerDownRight aria-label="Subtask" className="mr-1.5 inline size-3 text-muted-foreground" />}
                  {t.title}
                </button>
              </td>
              <td className={CELL}>
                <span className="flex items-center gap-1.5 text-foreground">
                  <StatusIcon type={t.stateType} color={t.stateColor} />
                  <span className="truncate">{t.stateName}</span>
                </span>
              </td>
              <td className={CELL}>
                <span className="flex items-center gap-2 text-muted-foreground">
                  <PriorityLamp value={t.priority} />
                  {priorityLabel(t.priority)}
                </span>
              </td>
              <td className={cn(CELL, "tabular-nums text-muted-foreground")}>{t.startDate ? dueLabel(t.startDate, props.today) : "—"}</td>
              <td
                className={cn(
                  CELL,
                  "tabular-nums",
                  isOverdue(t.dueDate, t.stateType, props.today) ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {t.dueDate ? dueLabel(t.dueDate, props.today) : "—"}
              </td>
              <td className={cn(CELL, "tabular-nums text-muted-foreground")}>{t.estimate ?? "—"}</td>
              <td className={cn(CELL, "truncate text-muted-foreground")}>{t.cycleName ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
