import { useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventContentArg, EventDropArg, EventMountArg } from "@fullcalendar/core";
import { useUpdateTask } from "@/lib/taskQueries";
import { toDateStr } from "@/lib/dates";
import { hiddenDaysFor, useWorkdays } from "@/lib/workweek";
import { eventAccent, tint } from "@/features/calendar/eventStyle";
import type { ViewProps } from "./ListView";

/** The list's dated tasks on a month grid; drag a chip to reschedule. Dateless tasks stay in the other views. */
export function CalendarView(props: ViewProps) {
  const update = useUpdateTask();
  const workdays = useWorkdays();
  const hiddenDays = useMemo(() => hiddenDaysFor(workdays), [workdays]);
  const events = useMemo(
    () =>
      props.tasks
        .filter((t) => t.dueDate)
        .map((t) => {
          const { color, overdue } = eventAccent(t, "state", props.today);
          return {
            id: t.id,
            title: t.title,
            start: t.dueDate as string,
            allDay: true,
            backgroundColor: "transparent",
            borderColor: "transparent",
            extendedProps: { color, overdue },
          };
        }),
    [props.tasks, props.today],
  );

  const renderEvent = (arg: EventContentArg) => {
    const { color, overdue } = arg.event.extendedProps as { color: string; overdue: boolean };
    return (
      <div
        className={`flex items-start gap-1.5 overflow-hidden rounded-md px-1.5 py-1 text-[13px] font-medium leading-snug ${overdue ? "ring-1 ring-destructive/60" : ""}`}
        style={{ backgroundColor: tint(color, 0.2) }}
      >
        <span className="mt-[6px] size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="line-clamp-2 text-foreground">{arg.event.title}</span>
      </div>
    );
  };

  // FullCalendar swallows React onContextMenu inside event content; listen natively.
  const onMount = (arg: EventMountArg) => {
    arg.el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      props.onMenu(e as unknown as React.MouseEvent, arg.event.id);
    });
  };

  return (
    <div className="h-full p-4 pb-20">
      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        firstDay={0}
        hiddenDays={hiddenDays}
        now={props.today}
        editable
        height="100%"
        dayMaxEvents
        fixedWeekCount={false}
        headerToolbar={{ left: "title", center: "", right: "prev,today,next" }}
        buttonText={{ today: "Today" }}
        events={events}
        eventContent={renderEvent}
        eventDidMount={onMount}
        eventClick={(arg) => props.onOpen(arg.event.id)}
        eventDrop={(arg: EventDropArg) => {
          if (arg.event.start) update.mutate({ id: arg.event.id, patch: { dueDate: toDateStr(arg.event.start) } });
        }}
      />
    </div>
  );
}
