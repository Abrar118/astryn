import { IndicatorLamp } from "@/components/IndicatorLamp";
import { cn } from "@/lib/utils";
import { DEFAULT_DISPLAY, type Completed, type DisplayKey, type DisplayProps, type Ordering } from "./viewConfig";

const DISPLAY_LABELS: Record<DisplayKey, string> = {
  id: "id",
  status: "status",
  priority: "priority",
  assignee: "assignee",
  dueDate: "due date",
  project: "project",
  labels: "labels",
  estimate: "estimate",
  cycle: "cycle",
  milestone: "milestone",
  links: "links",
  pullRequests: "pull requests",
  created: "created",
  updated: "updated",
};

/** A compact native select for the options panels (and the Issues toolbar). */
export const miniSelect =
  "dash-control h-7 w-32 cursor-pointer rounded-md border border-input bg-transparent px-2 text-[12px] text-foreground transition-colors hover:bg-accent dark:bg-input/30";

/** An on/off switch drawn as an indicator lamp and its legend: lit = on, unlit ring = off. */
export function LampToggle({
  label,
  on,
  onClick,
  className,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "dash-control flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] transition-colors hover:bg-accent",
        on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <IndicatorLamp tone={on ? "neutral" : "off"} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** A labelled row in an options panel: lowercase legend left, control right. */
export function OptionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

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
      <OptionRow label="ordering">
        <select aria-label="Ordering" className={miniSelect} value={ordering} onChange={(e) => onOrdering(e.target.value as Ordering)}>
          <option value="status">Status</option>
          <option value="priority">Priority</option>
          <option value="dueDate">Due date</option>
          <option value="title">Title</option>
          <option value="created">Created</option>
          <option value="updated">Updated</option>
        </select>
      </OptionRow>
      <OptionRow label="completed issues">
        <select aria-label="Completed issues" className={miniSelect} value={completed} onChange={(e) => onCompleted(e.target.value as Completed)}>
          <option value="all">All</option>
          <option value="active">Active only</option>
        </select>
      </OptionRow>

      <div className="border-t border-border pt-3" role="group" aria-label="Display properties">
        <div className="mb-1.5 text-[12px] text-muted-foreground">display properties</div>
        <div className="-mx-1.5 grid grid-cols-2 gap-x-1">
          {(Object.keys(DEFAULT_DISPLAY) as DisplayKey[]).map((k) => (
            <LampToggle key={k} label={DISPLAY_LABELS[k]} on={display[k]} onClick={() => onToggleDisplay(k)} />
          ))}
        </div>
      </div>
    </>
  );
}
