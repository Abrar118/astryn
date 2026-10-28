import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarClock, Check, ChevronRight, Maximize2, PanelRight, SignalHigh, SquareSplitHorizontal, Trash2, User } from "lucide-react";
import { StatusIcon } from "@/features/drawer/issueGlyphs";
import { DUE_PRESETS, PRIORITIES } from "@/features/issues/issueFields";
import { useLocalTree } from "@/lib/localTaskQueries";
import { useDeleteTask, useUpdateTask } from "@/lib/taskQueries";
import type { LocalTask } from "@/lib/commands";
import { LOCAL_ME, type TaskPatch } from "@/lib/tracker";
import { dhakaToday } from "@/lib/dates";
import { useWorkspace } from "@/lib/tabs";
import { cn } from "@/lib/utils";
import { statusesForList } from "./localTaskModel";

type Sub = "status" | "priority" | "due" | null;

const ITEM =
  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none";

/** Right-click menu for a local task (status, priority, due date, assignee, open, delete). */
export function LocalTaskMenu({ task, x, y, onClose }: { task: LocalTask; x: number; y: number; onClose: () => void }) {
  const { data: tree } = useLocalTree();
  const update = useUpdateTask();
  const del = useDeleteTask();
  const [params, setParams] = useSearchParams();
  const { openIssueTab, openIssueInRightSplit } = useWorkspace();
  const [sub, setSub] = useState<Sub>(null);
  const [confirm, setConfirm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(y);
  const statuses = statusesForList(tree, task.teamId ?? "");
  const left = Math.min(x, window.innerWidth - 248);

  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    setTop(y + h > window.innerHeight - 8 ? Math.max(8, y - h) : y);
  }, [y, sub, confirm]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>("button") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
        e.preventDefault();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const patch = (p: TaskPatch) => {
    update.mutate({ id: task.id, patch: p });
    onClose();
  };
  const today = dhakaToday();
  const mine = task.assigneeId === LOCAL_ME;

  const subButton = (key: Exclude<Sub, null>, icon: React.ReactNode, label: string) => (
    <button type="button" className={ITEM} aria-expanded={sub === key} onClick={() => setSub(sub === key ? null : key)}>
      {icon}
      <span className="flex-1">{label}</span>
      <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", sub === key && "rotate-90")} />
    </button>
  );

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`${task.identifier} actions`}
      className="fixed z-50 w-60 rounded-lg border border-border bg-popover p-1 shadow-2xl"
      style={{ left, top }}
    >
      <button type="button" className={ITEM} onClick={() => (setParams({ issue: task.id }), onClose())}>
        <PanelRight className="size-4 text-muted-foreground" /> Open
      </button>
      <button type="button" className={ITEM} onClick={() => (openIssueTab(task.id), onClose())}>
        <Maximize2 className="size-4 text-muted-foreground" /> Open in new tab
      </button>
      <button type="button" className={ITEM} onClick={() => (openIssueInRightSplit(task.id), onClose())}>
        <SquareSplitHorizontal className="size-4 text-muted-foreground" /> Open to the side
      </button>
      <div className="my-1 h-px bg-border" />
      {subButton("status", <StatusIcon type={task.stateType} color={task.stateColor} />, "Status")}
      {sub === "status" &&
        statuses.map((s) => (
          <button key={s.id} type="button" className={cn(ITEM, "pl-7")} onClick={() => patch({ stateId: s.id })}>
            <StatusIcon type={s.category} color={s.color} />
            <span className="flex-1">{s.name}</span>
            {s.id === task.stateId && <Check className="size-3.5 text-primary" />}
          </button>
        ))}
      {subButton("priority", <SignalHigh className="size-4 text-muted-foreground" />, "Priority")}
      {sub === "priority" &&
        PRIORITIES.map((p) => (
          <button key={p.value} type="button" className={cn(ITEM, "pl-7")} onClick={() => patch({ priority: p.value })}>
            <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="flex-1">{p.label}</span>
            {p.value === task.priority && <Check className="size-3.5 text-primary" />}
          </button>
        ))}
      {subButton("due", <CalendarClock className="size-4 text-muted-foreground" />, "Due date")}
      {sub === "due" &&
        DUE_PRESETS.map((p) => (
          <button key={p.label} type="button" className={cn(ITEM, "pl-7")} onClick={() => patch({ dueDate: p.resolve(today) })}>
            {p.label}
          </button>
        ))}
      <button type="button" className={ITEM} onClick={() => patch({ assigneeId: mine ? null : LOCAL_ME })}>
        <User className="size-4 text-muted-foreground" /> {mine ? "Unassign me" : "Assign to me"}
      </button>
      <div className="my-1 h-px bg-border" />
      {confirm ? (
        <button
          type="button"
          className={cn(ITEM, "bg-destructive/10 font-medium text-destructive hover:bg-destructive/20")}
          onClick={() => {
            del.mutate(task.id, { onSuccess: () => params.get("issue") === task.id && setParams({}) });
            onClose();
          }}
        >
          <Trash2 className="size-4" /> Confirm delete
        </button>
      ) : (
        <button type="button" className={cn(ITEM, "text-destructive hover:bg-destructive/10")} onClick={() => setConfirm(true)}>
          <Trash2 className="size-4" /> Delete task…
        </button>
      )}
    </div>
  );
}
