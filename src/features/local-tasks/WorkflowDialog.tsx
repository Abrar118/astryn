import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/Popover";
import { StatusIcon } from "@/features/drawer/issueGlyphs";
import { useSetLocalStatuses } from "@/lib/localTaskQueries";
import type { LocalStatusCategory, LocalStatusInput, LocalTree } from "@/lib/commands";
import { LocalDialog } from "./LocalDialog";

/** Sober status colors (user data, shown as dots and chips only). */
export const STATUS_COLORS = ["#858793", "#6f7a8c", "#5b8bd9", "#3a9894", "#479865", "#ac6721", "#c96a30", "#d05454", "#9479d1"];

const CATEGORIES: { value: LocalStatusCategory; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "unstarted", label: "Not started" },
  { value: "started", label: "Active" },
  { value: "completed", label: "Done" },
  { value: "canceled", label: "Closed" },
];

export type WorkflowScope = { kind: "space" | "list"; id: string; name: string };

/**
 * Edit a space's workflow, or a list's own workflow. A list starts from its
 * space's statuses; "Use the space's workflow" removes the override.
 */
export function WorkflowDialog({ scope, tree, onClose }: { scope: WorkflowScope; tree: LocalTree; onClose: () => void }) {
  const save = useSetLocalStatuses();
  const list = scope.kind === "list" ? tree.lists.find((l) => l.id === scope.id) : undefined;
  const own = tree.statuses.filter((s) => s.scopeId === scope.id).sort((a, b) => a.position - b.position);
  const inherited = list ? tree.statuses.filter((s) => s.scopeId === list.spaceId).sort((a, b) => a.position - b.position) : [];
  const [overriding, setOverriding] = useState(scope.kind === "space" || own.length > 0);
  const [rows, setRows] = useState<LocalStatusInput[]>(() =>
    (own.length > 0 ? own : inherited).map((s) => ({ id: s.id, name: s.name, category: s.category, color: s.color })),
  );

  const set = (i: number, change: Partial<LocalStatusInput>) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...change } : row)));
  const move = (i: number, by: number) =>
    setRows((r) => {
      const next = [...r];
      const j = i + by;
      if (j < 0 || j >= next.length) return r;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const valid = rows.length > 0 && rows.every((r) => r.name.trim());

  const submit = () => {
    const statuses = overriding ? rows.map((r) => ({ ...r, name: r.name.trim() })) : [];
    save.mutate({ scopeId: scope.id, statuses }, { onSuccess: onClose });
  };

  return (
    <LocalDialog
      title={`Workflow · ${scope.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={(overriding && !valid) || save.isPending}>
            Save workflow
          </Button>
        </>
      }
    >
      {scope.kind === "list" && (
        <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={!overriding}
            onChange={(e) => setOverriding(!e.target.checked)}
            className="size-4 cursor-pointer accent-primary"
          />
          Use the space's workflow
        </label>
      )}
      {overriding ? (
        <>
          <p className="mb-3 text-[13px] text-muted-foreground">
            The category decides where a status counts: Done and Closed tasks leave This Week and stop being overdue.
            Tasks in a removed status move to one of the same category.
          </p>
          <ol className="flex flex-col gap-1.5">
            {rows.map((row, i) => (
              <li key={row.id ?? `new-${i}`} className="flex items-center gap-2">
                <Popover
                  buttonTitle="Color"
                  buttonClassName="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-input hover:bg-accent lt-focus"
                  panelClassName="lt-overlay grid w-40 grid-cols-5 gap-1.5 rounded-lg border border-border bg-popover p-2"
                  button={<StatusIcon type={row.category} color={row.color} />}
                >
                  {(close) =>
                    STATUS_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={`Color ${c}`}
                        aria-pressed={c === row.color}
                        onClick={() => (set(i, { color: c }), close())}
                        className="size-6 cursor-pointer rounded-full ring-offset-2 ring-offset-popover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:ring-2 aria-pressed:ring-primary"
                        style={{ backgroundColor: c }}
                      />
                    ))
                  }
                </Popover>
                <Input
                  aria-label="Status name"
                  value={row.name}
                  onChange={(e) => set(i, { name: e.target.value })}
                  className="flex-1"
                />
                <select
                  aria-label="Category"
                  value={row.category}
                  onChange={(e) => set(i, { category: e.target.value as LocalStatusCategory })}
                  className="h-8 cursor-pointer rounded-lg border border-input bg-transparent px-2 text-sm text-foreground lt-focus dark:bg-input/30"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${row.name || "status"}`}
                  disabled={rows.length === 1}
                  onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ol>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setRows((r) => [...r, { id: null, name: "", category: "unstarted", color: STATUS_COLORS[2] }])}
          >
            <Plus /> Add status
          </Button>
        </>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          This list follows its space's workflow ({inherited.map((s) => s.name).join(", ")}).
        </p>
      )}
    </LocalDialog>
  );
}
