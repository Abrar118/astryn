import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { DAY_LABELS, saveWorkdays, useWorkdays } from "@/lib/workweek";
import { SectionHeader } from "../SectionHeader";

export function CalendarSection() {
  const workdays = useWorkdays();
  const toggleWorkday = (day: number) => {
    if (workdays.includes(day)) {
      // Never allow an empty week — FullCalendar can't render all-days-hidden.
      if (workdays.length === 1) return;
      saveWorkdays(workdays.filter((d) => d !== day));
    } else {
      saveWorkdays([...workdays, day]);
    }
  };

  return (
    <>
      <SectionHeader title="Calendar" description="How your week is laid out." />
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <Label>Week days</Label>
          <p className="text-sm text-muted-foreground">
            Days shown on the calendar. Unselected days are hidden so the rest get more space.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {DAY_LABELS.map((label, day) => {
            const active = workdays.includes(day);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={active}
                onClick={() => toggleWorkday(day)}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                  active
                    ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
                    : "text-muted-foreground ring-1 ring-border hover:bg-accent hover:text-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </Card>
    </>
  );
}
