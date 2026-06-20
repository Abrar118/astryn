import { ArrowDownUp } from "lucide-react";
import { DEFAULT_DISPLAY, type Completed, type DisplayKey, type DisplayProps, type Ordering } from "./viewConfig";

const DISPLAY_LABELS: Record<DisplayKey, string> = {
  id: "ID",
  status: "Status",
  priority: "Priority",
  assignee: "Assignee",
  dueDate: "Due date",
  project: "Project",
  labels: "Labels",
  estimate: "Estimate",
  cycle: "Cycle",
  milestone: "Milestone",
  links: "Links",
  pullRequests: "Pull requests",
  created: "Created",
  updated: "Updated",
};

export const miniSelect =
  "cursor-pointer rounded-md border border-border bg-secondary/40 px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function DisplayOptions({
  ordering,
  onOrdering,
  completed,
  onCompleted,
  display,
  onToggleDisplay,
}: {
  ordering: Ordering;
  onOrdering: (o: Ordering) => void;
  completed: Completed;
  onCompleted: (c: Completed) => void;
  display: DisplayProps;
  onToggleDisplay: (k: DisplayKey) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <ArrowDownUp className="size-3" /> Ordering
        </span>
        <select className={miniSelect} value={ordering} onChange={(e) => onOrdering(e.target.value as Ordering)}>
          <option value="status">Status</option>
          <option value="priority">Priority</option>
          <option value="dueDate">Due date</option>
          <option value="title">Title</option>
          <option value="created">Created</option>
          <option value="updated">Updated</option>
        </select>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Completed issues</span>
        <select className={miniSelect} value={completed} onChange={(e) => onCompleted(e.target.value as Completed)}>
          <option value="all">All</option>
          <option value="active">Active only</option>
        </select>
      </div>

      <div className="border-t border-border/60 pt-3">
        <div className="mb-1.5 text-muted-foreground">Display properties</div>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(DEFAULT_DISPLAY) as DisplayKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onToggleDisplay(k)}
              className={`cursor-pointer rounded-full border px-2 py-0.5 transition-colors ${
                display[k]
                  ? "border-transparent bg-accent text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {DISPLAY_LABELS[k]}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
