import { ArrowUpDown, Layers } from "lucide-react";
import type { PrSort } from "./prDisplay";

export type PrFilter = "all" | "conflicts" | "ci_failing";

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center rounded-lg border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`dash-control rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
            value === o.value ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Filter, sort and grouping for the active pull request queue. */
export function PrToolbar({
  sort,
  setSort,
  filter,
  setFilter,
  groupByRepo,
  setGroupByRepo,
}: {
  sort: PrSort;
  setSort: (v: PrSort) => void;
  filter: PrFilter;
  setFilter: (v: PrFilter) => void;
  groupByRepo: boolean;
  setGroupByRepo: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented<PrFilter>
        label="Filter"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: "All" },
          { value: "conflicts", label: "Conflicts" },
          { value: "ci_failing", label: "CI failing" },
        ]}
      />
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <ArrowUpDown aria-hidden className="size-3.5" />
        <Segmented<PrSort>
          label="Sort"
          value={sort}
          onChange={setSort}
          options={[
            { value: "updated", label: "Recent" },
            { value: "oldest", label: "Oldest" },
            { value: "largest", label: "Largest" },
          ]}
        />
      </span>
      <button
        type="button"
        aria-label="Group by repository"
        aria-pressed={groupByRepo}
        onClick={() => setGroupByRepo(!groupByRepo)}
        title="Group by repository"
        className={`dash-control flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[12px] font-medium transition-colors ${
          groupByRepo
            ? "border-input bg-accent text-foreground"
            : "border-border text-muted-foreground hover:text-foreground"
        }`}
      >
        <Layers aria-hidden className="size-3.5" /> Group
      </button>
    </div>
  );
}
