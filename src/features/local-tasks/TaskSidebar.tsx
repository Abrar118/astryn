import { useState } from "react";
import { FolderClosed, List, MoreHorizontal, Plus } from "lucide-react";
import { Popover, PopoverItem } from "@/components/Popover";
import {
  useCreateLocalList,
  useCreateLocalSpace,
  useDeleteLocalList,
  useDeleteLocalSpace,
  useRenameLocalSpace,
  useUpdateLocalList,
} from "@/lib/localTaskQueries";
import type { LocalList, LocalSpace, LocalTree } from "@/lib/commands";
import { cn } from "@/lib/utils";
import { suggestKey } from "./localTaskModel";
import { Caret } from "./LocalFields";

/** A one-line name input: Enter saves, Escape or an empty blur cancels. */
function InlineName({
  initial = "",
  placeholder,
  label,
  onSave,
  onCancel,
}: {
  initial?: string;
  placeholder: string;
  label: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      aria-label={label}
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && value.trim()) onSave(value.trim());
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
      onBlur={() => (value.trim() && value.trim() !== initial ? onSave(value.trim()) : onCancel())}
      className="h-7 w-full rounded-md border border-input bg-transparent px-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-[3px] focus:ring-ring/50"
    />
  );
}

/** "Delete …" that asks once more inside the same menu. */
function ConfirmDelete({ label, warning, onDelete }: { label: string; warning: string; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <div className="px-2 py-1.5">
      <p className="mb-2 text-[12px] text-muted-foreground">{warning}</p>
      <button
        type="button"
        autoFocus
        onClick={onDelete}
        className="w-full cursor-pointer rounded-md bg-destructive/15 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Delete permanently
      </button>
    </div>
  ) : (
    <PopoverItem danger label={label} onClick={() => setConfirming(true)} />
  );
}

const MENU_BUTTON =
  "flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100";
const MENU_PANEL = "w-56 rounded-md border border-border bg-popover p-1 shadow-2xl";

export type SidebarActions = {
  onWorkflow: (scope: { kind: "space" | "list"; id: string; name: string }) => void;
  onSprints: (space: LocalSpace) => void;
};

function ListItem({
  list,
  active,
  count,
  onSelect,
  actions,
}: {
  list: LocalList;
  active: boolean;
  count: number;
  onSelect: () => void;
  actions: SidebarActions;
}) {
  const [editing, setEditing] = useState<"name" | "key" | null>(null);
  const update = useUpdateLocalList();
  const remove = useDeleteLocalList();
  if (editing) {
    return (
      <div className="py-0.5 pl-6 pr-1">
        <InlineName
          initial={editing === "name" ? list.name : list.key}
          label={editing === "name" ? "List name" : "List key"}
          placeholder={editing === "name" ? "List name" : "Key, e.g. OPS"}
          onCancel={() => setEditing(null)}
          onSave={(v) =>
            update.mutate(
              { id: list.id, ...(editing === "name" ? { name: v } : { key: v.toUpperCase() }) },
              { onSettled: () => setEditing(null) },
            )
          }
        />
      </div>
    );
  }
  return (
    <div className="group flex items-center">
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={onSelect}
        className={cn(
          "flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-1 pl-6 pr-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active ? "bg-primary/20 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <List className={cn("size-3.5 shrink-0", active && "text-primary")} />
        <span className="truncate">{list.name}</span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">{count > 0 ? count : ""}</span>
      </button>
      <Popover align="end" buttonTitle={`${list.name} options`} buttonClassName={MENU_BUTTON} panelClassName={MENU_PANEL} button={<MoreHorizontal className="size-3.5" />}>
        {(close) => (
          <>
            <PopoverItem label="Rename" onClick={() => (setEditing("name"), close())} />
            <PopoverItem label={`Change key (${list.key})`} onClick={() => (setEditing("key"), close())} />
            <PopoverItem label="Workflow…" onClick={() => (actions.onWorkflow({ kind: "list", id: list.id, name: list.name }), close())} />
            <ConfirmDelete
              label="Delete list"
              warning={`Deletes ${list.name} and every task in it. Only a backup can bring them back.`}
              onDelete={() => (remove.mutate(list.id), close())}
            />
          </>
        )}
      </Popover>
    </div>
  );
}

/** Spaces and their lists (ClickUp's hierarchy) with inline create/rename and per-item menus. */
export function TaskSidebar({
  tree,
  selectedListId,
  openCounts,
  onSelect,
  actions,
}: {
  tree: LocalTree;
  selectedListId: string | null;
  /** Open (not done/closed) tasks per list id. */
  openCounts: Map<string, number>;
  onSelect: (listId: string) => void;
  actions: SidebarActions;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<"space" | string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const createSpace = useCreateLocalSpace();
  const createList = useCreateLocalList();
  const renameSpace = useRenameLocalSpace();
  const deleteSpace = useDeleteLocalSpace();
  const takenKeys = tree.lists.map((l) => l.key);

  return (
    <nav aria-label="Spaces and lists" className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="text-[11px] font-medium text-muted-foreground">Spaces</span>
        <button
          type="button"
          aria-label="New space"
          onClick={() => setAdding("space")}
          className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-24">
        {adding === "space" && (
          <div className="px-1 py-1">
            <InlineName
              label="Space name"
              placeholder="Space name"
              onCancel={() => setAdding(null)}
              onSave={(name) => createSpace.mutate(name, { onSettled: () => setAdding(null) })}
            />
          </div>
        )}
        {tree.spaces.map((space) => {
          const lists = tree.lists.filter((l) => l.spaceId === space.id);
          const open = !collapsed.has(space.id);
          return (
            <div key={space.id} className="mt-1">
              {renaming === space.id ? (
                <div className="px-1 py-0.5">
                  <InlineName
                    initial={space.name}
                    label="Space name"
                    placeholder="Space name"
                    onCancel={() => setRenaming(null)}
                    onSave={(name) => renameSpace.mutate({ id: space.id, name }, { onSettled: () => setRenaming(null) })}
                  />
                </div>
              ) : (
                <div className="group flex items-center">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() =>
                      setCollapsed((s) => {
                        const next = new Set(s);
                        if (next.has(space.id)) next.delete(space.id);
                        else next.add(space.id);
                        return next;
                      })
                    }
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-left text-[13px] font-semibold text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Caret open={open} />
                    <FolderClosed className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{space.name}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`New list in ${space.name}`}
                    onClick={() => setAdding(space.id)}
                    className={MENU_BUTTON}
                  >
                    <Plus className="size-3.5" />
                  </button>
                  <Popover align="end" buttonTitle={`${space.name} options`} buttonClassName={MENU_BUTTON} panelClassName={MENU_PANEL} button={<MoreHorizontal className="size-3.5" />}>
                    {(close) => (
                      <>
                        <PopoverItem label="Rename" onClick={() => (setRenaming(space.id), close())} />
                        <PopoverItem label="Workflow…" onClick={() => (actions.onWorkflow({ kind: "space", id: space.id, name: space.name }), close())} />
                        <PopoverItem label="Sprints…" onClick={() => (actions.onSprints(space), close())} />
                        <ConfirmDelete
                          label="Delete space"
                          warning={`Deletes ${space.name} with its ${lists.length} list${lists.length === 1 ? "" : "s"}, sprints and tasks.`}
                          onDelete={() => (deleteSpace.mutate(space.id), close())}
                        />
                      </>
                    )}
                  </Popover>
                </div>
              )}
              {open && (
                <div className="mt-0.5 flex flex-col gap-0.5">
                  {lists.map((list) => (
                    <ListItem
                      key={list.id}
                      list={list}
                      active={list.id === selectedListId}
                      count={openCounts.get(list.id) ?? 0}
                      onSelect={() => onSelect(list.id)}
                      actions={actions}
                    />
                  ))}
                  {adding === space.id && (
                    <div className="py-0.5 pl-6 pr-1">
                      <InlineName
                        label="List name"
                        placeholder="List name"
                        onCancel={() => setAdding(null)}
                        onSave={(name) =>
                          createList.mutate(
                            { spaceId: space.id, name, key: suggestKey(name, takenKeys) },
                            { onSuccess: (list) => onSelect(list.id), onSettled: () => setAdding(null) },
                          )
                        }
                      />
                    </div>
                  )}
                  {lists.length === 0 && adding !== space.id && (
                    <button
                      type="button"
                      onClick={() => setAdding(space.id)}
                      className="cursor-pointer rounded-md py-1 pl-6 text-left text-[12px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Add a list
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
