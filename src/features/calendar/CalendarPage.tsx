import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DatesSetArg, EventClickArg, EventContentArg, EventDropArg, EventMountArg } from "@fullcalendar/core";
import type { DropArg } from "@fullcalendar/interaction";
import { useCalendarTasks, useTasks, useUnscheduledTasks, useUpdateTask } from "@/lib/taskQueries";
import { ME, type Task, type TaskFilters } from "@/lib/tracker";
import { dhakaToday, rangeFromDates, toDateStr } from "@/lib/dates";
import { hiddenDaysFor, useWorkdays } from "@/lib/workweek";
import { useIssueMenu } from "@/features/issues/IssueContextMenu";
import { mountIssueMentionHoverCard } from "@/features/drawer/comments/IssueMentionPill";
import type { MentionTarget } from "@/features/drawer/markdownComponents";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { eventAccent } from "./eventStyle";
import { FilterBar } from "./FilterBar";
import { UnscheduledRail } from "./UnscheduledRail";

// Native contextmenu handlers per FullCalendar event element (for cleanup).
const ctxHandlers = new WeakMap<HTMLElement, (e: MouseEvent) => void>();

/** Build the shared hover-card payload from a cached task. */
function toMentionTarget(i: Task): MentionTarget {
  return {
    identifier: i.identifier,
    title: i.title,
    stateType: i.stateType,
    stateColor: i.stateColor,
    stateName: i.stateName,
    projectName: i.projectName,
    priority: i.priority,
    assigneeName: i.assigneeName,
  };
}

/**
 * A calendar event chip: a matte plate with the task's state (or priority) lamp,
 * plus the same rich issue hover-card used by editor mention pills. Overdue
 * titles read in the destructive tone. The right-click menu is wired
 * separately on the FullCalendar element (see `eventDidMount`) because a React
 * `onContextMenu` inside FullCalendar's custom event content does not fire.
 */
function CalendarChip({
  title,
  color,
  overdue,
  target,
}: {
  title: string;
  color: string;
  overdue: boolean;
  target: MentionTarget | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanup = useRef<(() => void) | null>(null);

  const close = () => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    cleanup.current?.();
    cleanup.current = null;
  };

  const scheduleOpen = () => {
    if (!target || openTimer.current || cleanup.current) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      if (ref.current) cleanup.current = mountIssueMentionHoverCard(target, ref.current.getBoundingClientRect());
    }, 150);
  };

  useEffect(() => close, []); // tear down the card/timer if the chip unmounts (e.g. month change)

  return (
    <div
      ref={ref}
      className="cal-chip flex items-start gap-1.5 overflow-hidden rounded-md px-1.5 py-1 text-[12px] font-medium leading-[1.35]"
      onMouseEnter={scheduleOpen}
      onMouseLeave={close}
    >
      <span className="dash-lamp dash-lamp-lit mt-[4px]" style={{ backgroundColor: color }} />
      <span className={cn("line-clamp-2", overdue ? "text-destructive" : "text-foreground")}>
        {overdue && <span className="sr-only">Overdue: </span>}
        {title}
      </span>
    </div>
  );
}

type CalendarView = "dayGridMonth" | "timeGridWeek";

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: "dayGridMonth", label: "Month" },
  { value: "timeGridWeek", label: "Week" },
];

function currentDhakaMonth(today: string) {
  const [y, m] = today.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, "0")}-01`;
  return { start, end };
}

export function CalendarPage() {
  const today = dhakaToday();
  const [range, setRange] = useState(() => currentDhakaMonth(today));
  // The header is ours (FullCalendar's toolbar is off); datesSet keeps it in step.
  const [view, setView] = useState<{ title: string; type: CalendarView; showsToday: boolean }>({
    title: "",
    type: "dayGridMonth",
    showsToday: true,
  });
  // Defaults to "my tasks" in every tracker; undefined assignee means "All assignees".
  const [filters, setFilters] = useState<TaskFilters>({ assigneeId: ME });
  const [colorBy, setColorBy] = useState<"state" | "priority">("state");
  const [, setParams] = useSearchParams();
  const update = useUpdateTask();
  const { openMenu } = useIssueMenu();
  const workdays = useWorkdays();
  const hiddenDays = useMemo(() => hiddenDaysFor(workdays), [workdays]);

  const { data: scheduled } = useCalendarTasks(range, filters);
  const { data: unscheduled } = useUnscheduledTasks(filters);
  const { data: allIssues } = useTasks({});

  // FullCalendar caches its size and only re-measures on window resize, so it
  // won't reclaim space when the unscheduled rail collapses. Nudge it directly.
  const calendarRef = useRef<FullCalendar>(null);
  const handleRailLayout = useCallback(() => {
    calendarRef.current?.getApi().updateSize();
  }, []);

  // Cached full issues power the hover-card (calendar/unscheduled shapes lack
  // assignee/project/state names).
  const issuesById = useMemo(() => new Map((allIssues ?? []).map((i) => [i.id, i])), [allIssues]);

  const events = useMemo(
    () =>
      (scheduled ?? [])
        .filter((i) => i.dueDate)
        .map((i) => {
          const { color, overdue } = eventAccent(i, colorBy, today);
          return {
            id: i.id,
            title: i.title,
            start: i.dueDate as string,
            allDay: true,
            // Rendered entirely by renderEvent; keep FC's own chrome invisible.
            backgroundColor: "transparent",
            borderColor: "transparent",
            extendedProps: { identifier: i.identifier, color, overdue },
          };
        }),
    [scheduled, colorBy, today],
  );

  // Matte lamp chip with the shared issue hover-card. (Right-click is wired via
  // eventDidMount below.)
  const renderEvent = (arg: EventContentArg) => {
    const { color, overdue } = arg.event.extendedProps as { color: string; overdue: boolean };
    const issue = issuesById.get(arg.event.id);
    return (
      <CalendarChip
        title={arg.event.title}
        color={color}
        overdue={overdue}
        target={issue ? toMentionTarget(issue) : null}
      />
    );
  };

  // FullCalendar swallows React onContextMenu on custom event content, so attach
  // a native contextmenu listener directly on each rendered event element.
  const onEventDidMount = (arg: EventMountArg) => {
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      openMenu(e as unknown as ReactMouseEvent, arg.event.id);
    };
    arg.el.addEventListener("contextmenu", handler);
    ctxHandlers.set(arg.el, handler);
  };
  const onEventWillUnmount = (arg: EventMountArg) => {
    const handler = ctxHandlers.get(arg.el);
    if (handler) {
      arg.el.removeEventListener("contextmenu", handler);
      ctxHandlers.delete(arg.el);
    }
  };

  const api = () => calendarRef.current?.getApi();
  const unit = view.type === "dayGridMonth" ? "month" : "week";

  return (
    <div className="calendar-surface flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-4 pt-5 pb-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 text-[20px] font-semibold tracking-tight text-foreground tabular-nums">
            {view.title}
          </h1>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon-sm" aria-label={`Previous ${unit}`} title={`Previous ${unit}`} onClick={() => api()?.prev()}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="sm" disabled={view.showsToday} onClick={() => api()?.today()}>
              Today
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Next ${unit}`} title={`Next ${unit}`} onClick={() => api()?.next()}>
              <ChevronRight />
            </Button>
          </div>
          <div role="group" aria-label="Calendar view" className="face-segment ml-auto">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                aria-pressed={view.type === v.value}
                onClick={() => api()?.changeView(v.value)}
                className="face-segment-item"
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <FilterBar filters={filters} colorBy={colorBy} onFilters={setFilters} onColorBy={setColorBy} />
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 pb-20">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            firstDay={0}
            hiddenDays={hiddenDays}
            now={today}
            editable={true}
            droppable={true}
            height="100%"
            dayMaxEvents={true}
            fixedWeekCount={false}
            headerToolbar={false}
            events={events}
            eventContent={renderEvent}
            eventDidMount={onEventDidMount}
            eventWillUnmount={onEventWillUnmount}
            datesSet={(arg: DatesSetArg) => {
              setRange(rangeFromDates(arg.start, arg.end));
              setView({
                title: arg.view.title,
                type: arg.view.type as CalendarView,
                showsToday: today >= toDateStr(arg.view.currentStart) && today < toDateStr(arg.view.currentEnd),
              });
            }}
            eventClick={(arg: EventClickArg) => setParams({ issue: arg.event.id })}
            eventDrop={(arg: EventDropArg) => {
              if (!arg.event.start) return;
              update.mutate({ id: arg.event.id, patch: { dueDate: toDateStr(arg.event.start) } });
            }}
            drop={(arg: DropArg) => {
              const id = arg.draggedEl.getAttribute("data-id");
              if (id) update.mutate({ id, patch: { dueDate: toDateStr(arg.date) } });
            }}
          />
        </div>
        <UnscheduledRail
          issues={unscheduled ?? []}
          onOpen={(id) => setParams({ issue: id })}
          onContextMenu={(e, id) => openMenu(e, id)}
          onCollapseChange={handleRailLayout}
        />
      </div>
    </div>
  );
}
