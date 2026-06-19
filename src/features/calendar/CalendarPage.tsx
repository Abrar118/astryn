import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DatesSetArg, EventClickArg, EventContentArg, EventDropArg } from "@fullcalendar/core";
import type { DropArg } from "@fullcalendar/interaction";
import { useCalendarIssues, useMe, useUnscheduled, useUpdateIssue } from "@/lib/queries";
import { dhakaToday, rangeFromDates, toDateStr } from "@/lib/dates";
import type { IssueFilters } from "@/lib/commands";
import { eventAccent, tint } from "./eventStyle";
import { FilterBar } from "./FilterBar";
import { UnscheduledRail } from "./UnscheduledRail";
import { IssueDrawer } from "@/features/drawer/IssueDrawer";

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

  // Soft tinted chip: colored dot + muted identifier + title (Linear/GCal style).
  const renderEvent = (arg: EventContentArg) => {
    const { identifier, color, overdue } = arg.event.extendedProps as {
      identifier: string;
      color: string;
      overdue: boolean;
    };
    return (
      <div
        className={`flex items-center gap-1.5 overflow-hidden rounded-md px-1.5 py-[3px] text-[11px] leading-tight ${
          overdue ? "ring-1 ring-red-500/60" : ""
        }`}
        style={{ backgroundColor: tint(color, 0.16) }}
        title={arg.event.title}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="shrink-0 font-medium text-muted-foreground">{identifier}</span>
        <span className="truncate text-foreground">{arg.event.title}</span>
      </div>
    );
  };

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <FilterBar filters={filters} colorBy={colorBy} meId={me.data?.viewerId} onFilters={handleFilters} onColorBy={setColorBy} />
        <div className="min-h-0 flex-1">
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
      </div>
      <UnscheduledRail issues={unscheduled ?? []} onOpen={(id) => setParams({ issue: id })} />
      <IssueDrawer />
    </div>
  );
}
