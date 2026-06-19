import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DatesSetArg, EventClickArg } from "@fullcalendar/core";
import { useCalendarIssues, useMe, useUnscheduled } from "@/lib/queries";
import { dhakaToday, rangeFromDates } from "@/lib/dates";
import type { IssueFilters } from "@/lib/commands";
import { eventStyle } from "./eventStyle";
import { FilterBar } from "./FilterBar";
import { UnscheduledRail } from "./UnscheduledRail";

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
        .map((i) => ({
          id: i.id,
          title: `${i.identifier}  ${i.title}`,
          start: i.dueDate as string,
          allDay: true,
          ...eventStyle(i, colorBy, today),
        })),
    [scheduled, colorBy, today],
  );

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 p-4">
        <FilterBar filters={filters} colorBy={colorBy} meId={me.data?.viewerId} onFilters={handleFilters} onColorBy={setColorBy} />
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          firstDay={0}
          now={today}
          editable={true}
          height="auto"
          headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek" }}
          events={events}
          datesSet={(arg: DatesSetArg) => setRange(rangeFromDates(arg.start, arg.end))}
          eventClick={(arg: EventClickArg) => setParams({ issue: arg.event.id })}
        />
      </div>
      <UnscheduledRail issues={unscheduled ?? []} onOpen={(id) => setParams({ issue: id })} />
    </div>
  );
}
