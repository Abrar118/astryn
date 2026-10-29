import { useState, useEffect, useId } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useTasks, useUpdateTask, useViewer } from "../../lib/taskQueries";
import { dhakaToday, weekWindow, addDays, isoWeek } from "../../lib/dates";
import { useWorkdays } from "../../lib/workweek";
import { buildAgenda, dueIssues } from "./agenda";
import type { Task } from "../../lib/tracker";
import { useIssueMenu } from "../issues/IssueContextMenu";
import { buildHeatmap, agendaCounts, type AgendaCounts, type HeatWeek } from "./agendaStats";
import { HeatMap } from "./HeatMap";
import { LampMessage } from "./LampMessage";
import { WeekBoard } from "./WeekBoard";
import { boardColumns } from "./weekColumns";
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

/** Whether the activity strip is open; remembered per viewer in local storage. */
const ACTIVITY_KEY = "astryn.this-week.activity";

function readActivityOpen(): boolean {
  try {
    return localStorage.getItem(ACTIVITY_KEY) === "1";
  } catch {
    return false;
  }
}

/** The 12-month heatmap, folded into one strip under the readouts until it is opened. */
function ActivityStrip({
  weeks,
  offset,
  onSelectWeek,
}: {
  weeks: HeatWeek[];
  offset: number;
  onSelectWeek: (offset: number) => void;
}) {
  const [open, setOpen] = useState(readActivityOpen);
  const labelId = useId();
  const panelId = useId();
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(ACTIVITY_KEY, next ? "1" : "0");
    } catch {
      // Storage unavailable: the strip still toggles for this session.
    }
  };
  return (
    <section aria-labelledby={labelId} className="border-y border-border">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className="dash-control flex w-full items-center gap-2 px-4 py-2 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent"
        >
          <ChevronDown aria-hidden className={cn("size-3.5 shrink-0 transition-transform", !open && "-rotate-90")} />
          <span id={labelId} className="font-medium text-foreground">activity</span>
          <span className="truncate">tasks due over the last 12 months{open ? " · select a week to jump to it" : ""}</span>
        </button>
      </h2>
      {open && (
        <div id={panelId} className="px-4 pt-1 pb-4">
          <HeatMap labelledBy={labelId} weeks={weeks} currentOffset={offset} onSelectWeek={onSelectWeek} />
        </div>
      )}
    </section>
  );
}

export function AgendaView() {
  const today = dhakaToday();
  const [weekOffset, setWeekOffset] = useState(0);
  const win = weekWindow(new Date(), weekOffset);
  const hintId = useId();
  const workdays = useWorkdays();

  const viewer = useViewer();
  const { data: issues, isLoading: issuesLoading } = useTasks({});
  const update = useUpdateTask();
  const { openMenu } = useIssueMenu();
  const [, setParams] = useSearchParams();

  const open = (id: string) => setParams({ issue: id });
  const byId = new Map((issues ?? []).map((i) => [i.id, i]));
  const parentOf = (task: Task) => (task.parentId ? byId.get(task.parentId) : undefined);

  // Arrow-key week navigation. A focused board card keeps the arrows for itself.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if a modifier key is held or something already handled the key
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
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
  const includeOverdue = weekOffset === 0;
  const groups = hasViewer
    ? buildAgenda({ issues: issues ?? [], viewerIds, window: win, includeOverdue })
    : [];
  const columns = boardColumns(groups, win, workdays, includeOverdue);

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

  return (
    <div className="week-pane h-full">
      <main className="week-main drawer-scrollbar flex h-full flex-col overflow-y-auto">
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

        {/* Overview: the week's readouts, then a year of due dates folded into one strip. */}
        {hasViewer && (
          <section aria-label="Week overview" className="border-t border-border">
            <WeekReadouts counts={counts} total={weekTotal} />
          </section>
        )}
        {hasViewer && <ActivityStrip weeks={heatmapWeeks} offset={weekOffset} onSelectWeek={setWeekOffset} />}

        {isEmpty ? (
          <LampMessage
            tone="success"
            title="Nothing on your plate this week."
            body="Tasks assigned to you and due this week are laid out here by day."
            className={hasViewer ? undefined : "border-t border-border"}
          />
        ) : (
          <>
            <p id={hintId} className="border-b border-border px-4 py-2 text-[12px] text-muted-foreground">
              Drag a card onto a day to reschedule it. Keyboard: arrows move between cards, shift + ← / → moves a card a
              day, enter opens it.
            </p>
            <div className="week-board-wrap">
              <WeekBoard
                columns={columns}
                today={today}
                hintId={hintId}
                parentOf={parentOf}
                onOpen={open}
                onMenu={(e, id) => openMenu(e, id)}
                onMove={(id, date) => update.mutate({ id, patch: { dueDate: date } })}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
