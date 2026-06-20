import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { Popover } from "./Popover";

/** Local YYYY-MM-DD (no timezone shift) from a Date. */
function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function pretty(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * A calendar date picker (react-day-picker) in a portal popover — replaces the
 * native <input type="date">. `value` / `onChange` use local YYYY-MM-DD.
 */
export function DatePicker({
  value,
  onChange,
  disabled,
  placeholder = "No due date",
  triggerClassName,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  triggerClassName?: string;
}) {
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;
  return (
    <Popover
      disabled={disabled}
      buttonTitle="Due date"
      buttonClassName={
        triggerClassName ??
        "flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-70"
      }
      panelClassName="rounded-xl border border-border bg-popover p-2 shadow-2xl"
      align="end"
      button={
        <span className="flex items-center gap-2">
          <CalendarIcon className="size-3.5 text-muted-foreground" />
          {value ? pretty(value) : <span className="text-muted-foreground">{placeholder}</span>}
        </span>
      }
    >
      {(close) => (
        <div className="rdp-root-wrap">
          <DayPicker
            mode="single"
            weekStartsOn={0}
            selected={selected}
            defaultMonth={selected}
            onSelect={(d) => {
              onChange(d ? toYMD(d) : null);
              close();
            }}
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                close();
              }}
              className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" /> Clear due date
            </button>
          )}
        </div>
      )}
    </Popover>
  );
}
