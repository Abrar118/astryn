import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useCreateLocalTask } from "@/lib/localTaskQueries";
import type { CreateLocalTaskInput } from "@/lib/commands";
import { cn } from "@/lib/utils";

/**
 * Inline "Add task": a quiet row that becomes a title input. Enter creates the
 * task and keeps the input open for the next one; Escape or an empty blur closes it.
 */
export function QuickAdd({
  base,
  label = "Add task",
  className,
  autoOpen = 0,
}: {
  /** Fields every task created here gets (list, status, parent, …). */
  base: Omit<CreateLocalTaskInput, "title">;
  label?: string;
  className?: string;
  /** Bump to open the input from outside (e.g. the N shortcut). */
  autoOpen?: number;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const create = useCreateLocalTask();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoOpen > 0) setOpen(true);
  }, [autoOpen]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    create.mutate({ ...base, title: t }, { onSuccess: () => setTitle("") });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "lt-focus flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-3 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          className,
        )}
      >
        <Plus className="size-3.5" />
        {label}
      </button>
    );
  }
  return (
    <div className={cn("flex h-9 items-center gap-2 px-3", className)}>
      <Plus className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={input}
        value={title}
        aria-label="New task title"
        placeholder="Task name — Enter to add, Esc to close"
        disabled={create.isPending}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setTitle("");
            setOpen(false);
          }
        }}
        onBlur={() => {
          if (!title.trim()) setOpen(false);
        }}
        className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-[3px] focus:ring-ring/50 dark:bg-input/30"
      />
    </div>
  );
}
