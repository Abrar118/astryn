import type { ReactNode } from "react";
import { AlertTriangle, ArrowUpDown, LayoutGrid, LayoutList, Layers, XCircle } from "lucide-react";
import type { GithubPr } from "@/lib/commands";
import { waitingLabel, type PrSort } from "./prDisplay";

export type PrFilter = "all" | "conflicts" | "ci_failing";
export type PrLayout = "board" | "stack";

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex items-center rounded-lg border border-border/60 bg-background/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
            value === o.value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** One-line triage summary derived from the open PRs. */
function Insight({ prs }: { prs: GithubPr[] }) {
  const needsReview = prs.filter((p) => p.bucket === "needs_review");
  const oldest = needsReview
    .map((p) => ({ p, w: waitingLabel(p.updatedAt, Date.now()) }))
    .filter((x) => x.w)
    .sort((a, b) => Date.parse(a.p.updatedAt ?? "") - Date.parse(b.p.updatedAt ?? ""))[0];
  const failing = prs.filter((p) => p.ciStatus === "failure").length;
  const conflicts = prs.filter((p) => p.mergeable === "conflicting").length;

  const parts: { key: string; node: ReactNode }[] = [];
  if (oldest) {
    parts.push({
      key: "oldest",
      node: (
        <span className={oldest.w!.level === "stale" ? "text-red-400" : oldest.w!.level === "warn" ? "text-amber-400" : ""}>
          Oldest review · #{oldest.p.number} ({oldest.w!.short})
        </span>
      ),
    });
  }
  if (failing > 0) {
    parts.push({
      key: "ci",
      node: (
        <span className="flex items-center gap-1 text-red-400">
          <XCircle className="size-3.5" /> {failing} failing CI
        </span>
      ),
    });
  }
  if (conflicts > 0) {
    parts.push({
      key: "conflict",
      node: (
        <span className="flex items-center gap-1 text-amber-400">
          <AlertTriangle className="size-3.5" /> {conflicts} conflicting
        </span>
      ),
    });
  }

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {parts.length === 0 ? (
        <span>You're all caught up — nothing needs attention.</span>
      ) : (
        parts.map((p, i) => (
          <span key={p.key} className="flex items-center gap-3">
            {i > 0 && <span className="text-border">·</span>}
            {p.node}
          </span>
        ))
      )}
    </div>
  );
}

export function PrToolbar({
  prs,
  sort,
  setSort,
  filter,
  setFilter,
  groupByRepo,
  setGroupByRepo,
  layout,
  setLayout,
}: {
  prs: GithubPr[];
  sort: PrSort;
  setSort: (v: PrSort) => void;
  filter: PrFilter;
  setFilter: (v: PrFilter) => void;
  groupByRepo: boolean;
  setGroupByRepo: (v: boolean) => void;
  layout: PrLayout;
  setLayout: (v: PrLayout) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/50 bg-card/40 px-5 py-3">
      <Insight prs={prs} />
      <div className="flex shrink-0 items-center gap-2">
        <Segmented<PrFilter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "conflicts", label: "Conflicts" },
            { value: "ci_failing", label: "CI failing" },
          ]}
        />
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <ArrowUpDown className="size-4" />
          <Segmented<PrSort>
            value={sort}
            onChange={setSort}
            options={[
              { value: "updated", label: "Recent" },
              { value: "oldest", label: "Oldest" },
              { value: "largest", label: "Largest" },
            ]}
          />
        </span>
        <div className="flex items-center rounded-lg border border-border/60 bg-background/40 p-0.5">
          {([
            { value: "board", label: "Board view", Icon: LayoutGrid },
            { value: "stack", label: "List view", Icon: LayoutList },
          ] as const).map((o) => (
            <button
              key={o.value}
              type="button"
              aria-label={o.label}
              aria-pressed={layout === o.value}
              title={o.label}
              onClick={() => setLayout(o.value)}
              className={`flex items-center rounded-md px-2 py-1.5 transition-colors ${
                layout === o.value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <o.Icon className="size-4" />
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={groupByRepo}
          onClick={() => setGroupByRepo(!groupByRepo)}
          title="Group by repository"
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
            groupByRepo
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border/60 bg-background/40 text-muted-foreground hover:text-foreground"
          }`}
        >
          <Layers className="size-4" /> Group
        </button>
      </div>
    </div>
  );
}
