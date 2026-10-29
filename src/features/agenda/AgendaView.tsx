import { statusHue } from "@/lib/statusHue";
import { useState, useEffect, useId } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, CornerDownRight } from "lucide-react";
import { useTasks, useTaskUsers, useViewer } from "../../lib/taskQueries";
import { dhakaToday, weekWindow, addDays, isoWeek } from "../../lib/dates";
import { buildAgenda, dueIssues, type AgendaGroup, type AgendaItem } from "./agenda";
import type { Task } from "../../lib/tracker";
import { IssueRow } from "../issues/IssueRow";
import { DEFAULT_DISPLAY } from "../issues/viewConfig";
import { useIssueMenu } from "../issues/IssueContextMenu";
import { buildHeatmap, agendaCounts, type AgendaCounts } from "./agendaStats";
import { HeatMap } from "./HeatMap";
import { LampMessage } from "./LampMessage";
import { Button } from "@/components/ui/button";
import { IndicatorLamp, type Lamp } from "@/components/IndicatorLamp";
import { cn } from "@/lib/utils";

const READOUTS: { key: keyof AgendaCounts; label: string; lamp: Lamp; alarm?: boolean }[] = [
  { key: "todo", label: "todo", lamp: "neutral" },
  { key: "inProgress", label: "in progress", lamp: "neutral" },
  { key: "inReview", label: "in review", lamp: "neutral" },
  { key: "overdue", label: "overdue", lamp: "danger", alarm: true },
];

/** The week's counts as readouts: light numerals over lowercase legends with lamps. */
function WeekReadouts({ counts, total }: { counts: AgendaCounts; total: number }) {
  const cells = [
    { key: "due", label: "on your plate", value: total, lamp: "neutral" as Lamp, alarm: false },
    ...READOUTS.map((r) => ({ ...r, value: counts[r.key], alarm: !!r.alarm })),
  ];
  return (
    <ul aria-label="This week's counts" className="week-readouts">
      {cells.map((c) => (
        <li key={c.key} className="week-readout">
          <span className={cn("dash-numeral text-[28px]", c.alarm && c.value ? "text-destructive" : "text-foreground")}>
            {c.value}
          </span>
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <IndicatorLamp tone={c.value ? c.lamp : "off"} />
            {c.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Format a YYYY-MM-DD date as "Jun 21". */
function shortDate(date: string): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const d = new Date(`${date}T00:00:00Z`);
  return `${months[d.getUTCMonth()] ?? ""} ${d.getUTCDate()}`;
}

function GroupHeader({ group, today, count }: { group: AgendaGroup; today: string; count: number }) {
  const isToday = group.key === today;
  const overdue = group.key === "overdue";
  return (
    <div className="sticky top-0 z-10 flex items-baseline gap-2.5 border-b border-border bg-background px-4 pt-3 pb-2">
      <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{group.label}</h2>
      {group.date && <span className="text-[13px] tabular-nums text-muted-foreground">{shortDate(group.date)}</span>}
      {isToday && (
        <span className="flex items-center gap-1.5 self-center text-[12px] font-semibold text-foreground">
          <span aria-hidden className="dash-lamp bg-primary" />
          today
        </span>
      )}
      <span className={cn(
        "ml-auto text-[12px] tabular-nums",
        overdue && count ? "text-destructive" : "text-muted-foreground",
      )}>
        {count} due
      </span>
    </div>
  );
}

export function AgendaView() {
  const today = dhakaToday();
  const [weekOffset, setWeekOffset] = useState(0);
  const win = weekWindow(new Date(), weekOffset);
  const activityId = useId();

  const viewer = useViewer();
  const { data: issues, isLoading: issuesLoading } = useTasks({});
  const { data: users } = useTaskUsers();
  const { openMenu } = useIssueMenu();
  const [, setParams] = useSearchParams();

  const open = (id: string) => setParams({ issue: id });
  const avatarOf = (id: string | null) => {
    if (!id) return null;
    const u = (users ?? []).find((x) => x.id === id);
    return u ? { name: u.name, avatarUrl: u.avatarUrl } : null;
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

  if (issuesLoading || viewer.isLoading) {
    return (
      <div aria-busy className="h-full">
        <LampMessage tone="off" title="Reading cached tasks…" body="Your week appears as soon as the local cache is read." />
      </div>
    );
  }

  const { viewerIds } = viewer;
  const hasViewer = viewerIds.length > 0;
  const groups = hasViewer
    ? buildAgenda({ issues: issues ?? [], viewerIds, window: win, includeOverdue: weekOffset === 0 })
    : [];

  const isEmpty = groups.every((g) => g.items.length === 0);

  // Week-number label: use Thursday of the Sun-started week for ISO week number
  const thursday = addDays(win.weekStart, 4);
  const { week: weekNum, year: weekYear } = isoWeek(thursday);
  const currentYear = Number(dhakaToday().slice(0, 4));
  const weekLabel = weekYear !== currentYear ? `Week ${weekNum} · ${weekYear}` : `Week ${weekNum}`;
  const rangeLabel = `${shortDate(win.weekStart)} – ${shortDate(addDays(win.weekStart, 6))}`;

  // Overview data
  const heatmapWeeks = hasViewer
    ? buildHeatmap(issues ?? [], viewerIds, { now: new Date(), weeksBack: 51, weeksForward: 1 })
    : [];
  const counts = agendaCounts(groups);
  const weekTotal = groups.reduce((n, g) => n + dueIssues(g).length, 0);

  const renderRow = (issue: Task) => (
    <IssueRow
      issue={issue}
      display={DEFAULT_DISPLAY}
      avatar={avatarOf(issue.assigneeId)}
      onOpen={open}
      onContextMenu={(e) => openMenu(e, issue.id)}
      today={today}
      size="base"
      startedAt={issue.startedAt}
    />
  );

  // A parent shown only to give its due sub-issues context (it isn't itself due
  // in this group) — a muted heading, still clickable/right-clickable.
  const renderContextParent = (issue: Task) => (
    <button
      type="button"
      onClick={() => open(issue.id)}
      onContextMenu={(e) => openMenu(e, issue.id)}
      className="dash-control flex w-full items-center gap-2 px-4 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent"
    >
      <span
        className="dash-lamp dash-lamp-lit"
        style={{ backgroundColor: statusHue(issue.stateColor) }}
        title={issue.stateName ?? undefined}
      />
      <span className="shrink-0 font-mono">{issue.identifier}</span>
      <span className="truncate">{issue.title}</span>
      <CornerDownRight className="size-3 shrink-0" aria-hidden />
    </button>
  );

  const renderItem = (item: AgendaItem) => (
    <div key={item.issue.id}>
      {item.contextOnly ? renderContextParent(item.issue) : renderRow(item.issue)}
      {item.children.length > 0 && (
        <div className="ml-5 border-l border-border pl-1">
          {item.children.map((c) => (
            <div key={c.id}>{renderRow(c)}</div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <main className="drawer-scrollbar flex h-full flex-col overflow-y-auto">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-5 pb-3">
        <h1 className="text-[20px] font-semibold tracking-tight text-foreground tabular-nums">{weekLabel}</h1>
        <span className="text-[13px] tabular-nums text-muted-foreground">{rangeLabel}</span>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" aria-label="Previous week" title="Previous week" onClick={() => setWeekOffset((o) => o - 1)}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="sm" disabled={weekOffset === 0} onClick={() => setWeekOffset(0)}>
            This week
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Next week" title="Next week" onClick={() => setWeekOffset((o) => o + 1)}>
            <ChevronRight />
          </Button>
        </div>
        <span className="ml-auto text-[12px] text-muted-foreground">← / → to change week</span>
      </header>

      {/* Overview: the week's readouts, then a year of due dates to jump through. */}
      {hasViewer && (
        <section aria-label="Week overview" className="border-y border-border">
          <WeekReadouts counts={counts} total={weekTotal} />
          <div className="border-t border-border px-4 pt-3 pb-4">
            <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id={activityId} className="text-[13px] font-semibold tracking-tight text-foreground">Activity</h2>
              <p className="text-[12px] text-muted-foreground">tasks due over the last 12 months · select a week to jump to it</p>
            </div>
            <HeatMap
              labelledBy={activityId}
              weeks={heatmapWeeks}
              currentOffset={weekOffset}
              onSelectWeek={setWeekOffset}
            />
          </div>
        </section>
      )}

      {/* Issue list */}
      {isEmpty ? (
        <LampMessage
          tone="success"
          title="Nothing on your plate this week."
          body="Tasks assigned to you and due this week are listed here by day."
          className={hasViewer ? undefined : "border-t border-border"}
        />
      ) : (
        <div className="pb-28">
          {groups.map((g) => {
            const count = dueIssues(g).length;
            return (
              <section key={g.key} aria-label={g.date ? `${g.label} ${shortDate(g.date)}` : g.label}>
                <GroupHeader group={g} today={today} count={count} />
                {g.items.length ? (
                  g.items.map(renderItem)
                ) : (
                  <p className="flex items-center gap-3 px-4 py-2.5 text-[12px] text-muted-foreground">
                    <IndicatorLamp tone="off" />
                    nothing due
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
