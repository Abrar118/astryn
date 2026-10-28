import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/DatePicker";
import { addDays, dhakaToday } from "@/lib/dates";
import { useCreateLocalSprint, useDeleteLocalSprint, useUpdateLocalSprint } from "@/lib/localTaskQueries";
import type { LocalSprint, LocalTree } from "@/lib/commands";
import { LocalDialog } from "./LocalDialog";

function SprintRow({ sprint }: { sprint: LocalSprint }) {
  const update = useUpdateLocalSprint();
  const remove = useDeleteLocalSprint();
  const [name, setName] = useState(sprint.name);
  const save = (change: Partial<Pick<LocalSprint, "name" | "startDate" | "endDate">>) => {
    const next = { name: sprint.name, startDate: sprint.startDate, endDate: sprint.endDate, ...change };
    if (!next.name.trim()) return;
    update.mutate({ id: sprint.id, ...next, name: next.name.trim() });
  };
  return (
    <li className="flex items-center gap-2">
      <Input
        aria-label="Sprint name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() !== sprint.name && save({ name })}
        className="flex-1"
      />
      <DatePicker value={sprint.startDate} placeholder="Start" onChange={(startDate) => save({ startDate })} />
      <DatePicker value={sprint.endDate} placeholder="End" onChange={(endDate) => save({ endDate })} />
      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${sprint.name}`} onClick={() => remove.mutate(sprint.id)}>
        <Trash2 />
      </Button>
    </li>
  );
}

/** Sprints of one space: rename, set dates, add (two weeks from today by default), delete. */
export function SprintDialog({ spaceId, spaceName, tree, onClose }: { spaceId: string; spaceName: string; tree: LocalTree; onClose: () => void }) {
  const create = useCreateLocalSprint();
  const sprints = tree.sprints.filter((s) => s.spaceId === spaceId);
  const addSprint = () => {
    const last = sprints[sprints.length - 1];
    const start = last?.endDate ? addDays(last.endDate, 1) : dhakaToday();
    create.mutate({ spaceId, name: `Sprint ${(last?.number ?? 0) + 1}`, startDate: start, endDate: addDays(start, 13) });
  };
  return (
    <LocalDialog
      title={`Sprints · ${spaceName}`}
      onClose={onClose}
      footer={
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
      }
    >
      {sprints.length === 0 ? (
        <p className="mb-3 text-[13px] text-muted-foreground">
          Sprints are time boxes for this space. Add one, then set a task's sprint from its drawer or filter a list by it.
        </p>
      ) : (
        <ul className="mb-3 flex flex-col gap-1.5">
          {sprints.map((s) => (
            <SprintRow key={s.id} sprint={s} />
          ))}
        </ul>
      )}
      <Button variant="ghost" size="sm" onClick={addSprint} disabled={create.isPending}>
        <Plus /> Add sprint
      </Button>
    </LocalDialog>
  );
}
