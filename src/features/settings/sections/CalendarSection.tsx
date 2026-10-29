import { cn } from "@/lib/utils";
import { IndicatorLamp } from "@/components/IndicatorLamp";
import { DAY_LABELS, saveWorkdays, useWorkdays } from "@/lib/workweek";
import { SectionHeader } from "../SectionHeader";
import { SettingsPanel, SettingsZone } from "../SettingsPanel";

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
      <SettingsPanel label="Week days">
        <SettingsZone
          title="Week days"
          hint="Days shown on the calendar. Unselected days are hidden so the rest get more space."
        >
          <div role="group" aria-label="Week days" className="grid grid-cols-7 gap-1">
            {DAY_LABELS.map((label, day) => {
              const active = workdays.includes(day);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleWorkday(day)}
                  className={cn(
                    "dash-control flex flex-col items-start gap-2 rounded-md px-2.5 py-2 text-[12px] transition-colors hover:bg-accent",
                    active ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  <IndicatorLamp tone={active ? "neutral" : "off"} />
                  <span className="lowercase">{label}</span>
                </button>
              );
            })}
          </div>
        </SettingsZone>
      </SettingsPanel>
    </>
  );
}
