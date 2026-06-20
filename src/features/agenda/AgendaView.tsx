import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { useIssues, useRelations, useMe, useUsers } from "../../lib/queries";
import { dhakaToday, weekWindow, addDays, isoWeek } from "../../lib/dates";
import { buildAgenda, type AgendaItem } from "./agenda";
import { IssueRow } from "../issues/IssueRow";
import { DEFAULT_DISPLAY } from "../issues/viewConfig";
import { useIssueMenu } from "../issues/IssueContextMenu";
import { buildHeatmap, statusBreakdown, priorityBreakdown } from "./agendaStats";
import { HeatMap } from "./HeatMap";
import { StatusDonut } from "./StatusDonut";
import { PriorityBar } from "./PriorityBar";
import { DependencyGraph } from "./DependencyGraph";

const RELATION_LABEL: Record<string, string> = {
  blocks: "Blocks",
  blocked_by: "Blocked by",
  related: "Related",
  duplicate: "Duplicate",
};

/** Format a YYYY-MM-DD date as "Jun 21". */
function shortDate(date: string): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const d = new Date(`${date}T00:00:00Z`);
  return `${months[d.getUTCMonth()] ?? ""} ${d.getUTCDate()}`;
}

export function AgendaView() {
  const today = dhakaToday();
  const [weekOffset, setWeekOffset] = useState(0);
  const win = weekWindow(new Date(), weekOffset);

  const me = useMe();
  const { data: issues, isLoading: issuesLoading } = useIssues({});
  const { data: relations, isLoading: relsLoading } = useRelations();
  const { data: users } = useUsers();
  const { openMenu } = useIssueMenu();
  const [, setParams] = useSearchParams();

  const open = (id: string) => setParams({ issue: id });
  const avatarOf = (id: string | null) => {
    if (!id) return null;
    const u = (users ?? []).find((x) => x.id === id);
    return u ? { name: u.name } : null;
  };

  // Arrow-key week navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if modifier key held
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Ignore if focus is in an input-like element
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        if (target.isContentEditable) return;
      }
      if (e.key === "ArrowLeft") {
        setWeekOffset((o) => o - 1);
      } else if (e.key === "ArrowRight") {
        setWeekOffset((o) => o + 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (issuesLoading || relsLoading || me.isLoading) {
    return (
      <div className="space-y-2 p-6">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded bg-muted/50" />
        ))}
      </div>
    );
  }

  const viewerId = me.data?.viewerId;
  const groups = viewerId
    ? buildAgenda({ issues: issues ?? [], relations: relations ?? [], viewerId, window: win })
    : [];

  const isEmpty = groups.every((g) => g.items.length === 0);

  // Week-number label: use Thursday of the Sun-started week for ISO week number
  const thursday = addDays(win.weekStart, 4);
  const { week: weekNum, year: weekYear } = isoWeek(thursday);
  const currentYear = Number(dhakaToday().slice(0, 4));
  const weekLabel = weekYear !== currentYear ? `Week ${weekNum} · ${weekYear}` : `Week ${weekNum}`;
  const rangeLabel = `${shortDate(win.weekStart)} – ${shortDate(addDays(win.weekStart, 6))}`;

  // Dashboard data
  const heatmapWeeks = viewerId
    ? buildHeatmap(issues ?? [], viewerId, { now: new Date(), weeksBack: 8, weeksForward: 1 })
    : [];
  const weekIssues = groups.flatMap((g) => g.items).map((it) => it.issue);

  const renderItem = (item: AgendaItem) => (
    <div key={item.issue.id}>
      <IssueRow
        issue={item.issue}
        display={DEFAULT_DISPLAY}
        avatar={avatarOf(item.issue.assigneeId)}
        onOpen={open}
        onContextMenu={(e) => openMenu(e, item.issue.id)}
        today={today}
      />
      {(item.children.length > 0 || item.relations.length > 0) && (
        <div className="ml-5 border-l border-white/15 pl-1">
          {item.children.map((child) => (
            <IssueRow
              key={child.id}
              issue={child}
              display={DEFAULT_DISPLAY}
              avatar={avatarOf(child.assigneeId)}
              onOpen={open}
              onContextMenu={(e) => openMenu(e, child.id)}
              today={today}
            />
          ))}
          {item.relations.map((r) => (
            <button
              key={`${r.type}-${r.relatedId}`}
              type="button"
              onClick={() => open(r.relatedId)}
              className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span className="w-16 shrink-0 uppercase tracking-wide text-[10px]">
                {RELATION_LABEL[r.type] ?? r.type}
              </span>
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: r.relatedStateColor ?? "#888" }}
                title={r.relatedStateName ?? undefined}
              />
              <span className="w-16 shrink-0 font-mono">{r.relatedIdentifier}</span>
              <span className="flex-1 truncate text-foreground/80">{r.relatedTitle}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <CalendarRange className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex flex-1 items-center gap-1.5 min-w-0">
          {/* Week nav */}
          <button
            type="button"
            aria-label="Previous week"
            onClick={() => setWeekOffset((o) => o - 1)}
            className="cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold leading-tight">{weekLabel}</span>
            <span className="text-[11px] text-muted-foreground leading-tight">{rangeLabel}</span>
          </div>
          <button
            type="button"
            aria-label="Next week"
            onClick={() => setWeekOffset((o) => o + 1)}
            className="cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <ChevronRight className="size-4" />
          </button>
          {weekOffset !== 0 && (
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              className="ml-1 cursor-pointer rounded px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              This Week
            </button>
          )}
        </div>
      </header>

      {/* Dashboard — only when not loading and viewer is known */}
      {viewerId && (
        <div className="border-b border-border/60 px-4 py-4 space-y-5">
          {/* Heatmap */}
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Activity
            </p>
            <HeatMap
              weeks={heatmapWeeks}
              currentOffset={weekOffset}
              onSelectWeek={setWeekOffset}
            />
          </div>

          {/* Overview charts */}
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Overview
            </p>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="mb-2 text-[11px] text-muted-foreground">Status</p>
                <StatusDonut data={statusBreakdown(weekIssues)} />
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="mb-2 text-[11px] text-muted-foreground">Priority</p>
                <PriorityBar data={priorityBreakdown(weekIssues)} />
              </div>
            </div>
          </div>

          {/* Dependency graph */}
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Dependencies
            </p>
            <DependencyGraph
              items={groups.flatMap((g) => g.items)}
              allIssues={issues ?? []}
              onOpen={open}
            />
          </div>
        </div>
      )}

      {/* Issue list */}
      {isEmpty ? (
        <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground">
          Nothing on your plate this week.
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {groups.map((g) => (
            <section key={g.key}>
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-background/95 px-4 py-2.5 backdrop-blur">
                <span className="text-[15px] font-semibold">{g.label}</span>
                {g.date && <span className="text-xs text-muted-foreground">{g.date}</span>}
                <span className="ml-auto text-xs text-muted-foreground">{g.items.length}</span>
              </div>
              {g.items.length ? (
                g.items.map(renderItem)
              ) : (
                <div className="px-4 py-2 text-xs text-muted-foreground/70">Nothing due</div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
