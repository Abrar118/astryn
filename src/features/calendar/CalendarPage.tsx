import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DatesSetArg, EventClickArg, EventContentArg, EventDropArg } from "@fullcalendar/core";
import type { DropArg } from "@fullcalendar/interaction";
import { useCalendarIssues, useIssues, useMe, useUnscheduled, useUpdateIssue } from "@/lib/queries";
import { dhakaToday, rangeFromDates, toDateStr } from "@/lib/dates";
import type { IssueFilters, IssueListItem } from "@/lib/commands";
import { useIssueMenu } from "@/features/issues/IssueContextMenu";
import { mountIssueMentionHoverCard } from "@/features/drawer/comments/IssueMentionPill";
import type { MentionTarget } from "@/features/drawer/markdownComponents";
import { eventAccent, tint } from "./eventStyle";
import { FilterBar } from "./FilterBar";
import { UnscheduledRail } from "./UnscheduledRail";

/** Build the shared hover-card payload from a cached issue. */
function toMentionTarget(i: IssueListItem): MentionTarget {
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
 * A calendar event chip: the soft tinted Linear/GCal pill, plus the same rich
 * issue hover-card used by editor mention pills, and the issue right-click menu.
 */
function CalendarChip({
  title,
  color,
  overdue,
  target,
  onContextMenu,
}: {
  title: string;
  color: string;
  overdue: boolean;
  target: MentionTarget | null;
  onContextMenu: (e: ReactMouseEvent) => void;
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
      className={`flex items-start gap-1.5 overflow-hidden rounded-md px-1.5 py-1.5 text-[13px] font-semibold leading-snug ${
        overdue ? "ring-1 ring-red-500/60" : ""
      }`}
      style={{ backgroundColor: tint(color, 0.2) }}
      onContextMenu={onContextMenu}
      // Keep right-click from reaching FullCalendar's drag delegation so the
      // context menu always fires.
      onMouseDown={(e) => {
        if (e.button === 2) e.stopPropagation();
      }}
      onMouseEnter={scheduleOpen}
      onMouseLeave={close}
    >
      <span className="mt-[6px] size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="line-clamp-2 text-foreground">{title}</span>
    </div>
  );
}

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
  const me = useMe();
  const [range, setRange] = useState(() => currentDhakaMonth(today));
  const [filters, setFilters] = useState<IssueFilters>({});
  const [initialized, setInitialized] = useState(false);
  const [colorBy, setColorBy] = useState<"state" | "priority">("state");
  const [, setParams] = useSearchParams();
  const update = useUpdateIssue();
  const { openMenu } = useIssueMenu();

  // Default the assignee filter to "me" exactly once, when identity loads. After
  // that, filters.assigneeId === undefined genuinely means "All assignees".
  useEffect(() => {
    if (!initialized && me.data) {
      setFilters({ assigneeId: me.data.viewerId });
      setInitialized(true);
    }
  }, [me.data, initialized]);

  const { data: scheduled } = useCalendarIssues(range, filters);
  const { data: unscheduled } = useUnscheduled(filters);
  const { data: allIssues } = useIssues({});

  // Cached full issues power the hover-card (calendar/unscheduled shapes lack
  // assignee/project/state names).
  const issuesById = useMemo(() => new Map((allIssues ?? []).map((i) => [i.id, i])), [allIssues]);

  // Any explicit filter interaction counts as "initialized" so the me-default
  // effect above can never later clobber a deliberate "All assignees" choice.
  const handleFilters = (f: IssueFilters) => {
    setInitialized(true);
    setFilters(f);
  };

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

  // Soft tinted chip with the shared issue hover-card + right-click menu.
  const renderEvent = (arg: EventContentArg) => {
    const { color, overdue } = arg.event.extendedProps as { color: string; overdue: boolean };
    const issue = issuesById.get(arg.event.id);
    return (
      <CalendarChip
        title={arg.event.title}
        color={color}
        overdue={overdue}
        target={issue ? toMentionTarget(issue) : null}
        onContextMenu={(e) => openMenu(e, arg.event.id)}
      />
    );
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4 pb-4">
      <FilterBar filters={filters} colorBy={colorBy} meId={me.data?.viewerId} onFilters={handleFilters} onColorBy={setColorBy} />
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
        <div className="min-h-0 min-w-0 flex-1 p-3 pb-20">
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            firstDay={0}
            now={today}
            editable={true}
            droppable={true}
            height="100%"
            dayMaxEvents={true}
            fixedWeekCount={false}
            headerToolbar={{ left: "title", center: "", right: "prev,today,next dayGridMonth,timeGridWeek" }}
            buttonText={{ today: "Today", month: "Month", week: "Week" }}
            events={events}
            eventContent={renderEvent}
            datesSet={(arg: DatesSetArg) => setRange(rangeFromDates(arg.start, arg.end))}
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
        />
      </div>
    </div>
  );
}
