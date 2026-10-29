import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IndicatorLamp, type Lamp } from "@/components/IndicatorLamp";

/** One faceplate panel. Its direct `SettingsZone` children are divided by hairlines. */
export function SettingsPanel({ label, children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={label} className={cn("dash-panel dash-face", className)}>
      {children}
    </section>
  );
}

/** A zone of a settings panel: an optional title and hint, then its controls. */
export function SettingsZone({
  title,
  hint,
  aside,
  children,
  className,
}: {
  title?: string;
  hint?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("dash-zone flex flex-col gap-3 px-4 py-4", className)}>
      {(title || aside) && (
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title && <h2 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h2>}
            {hint && <p className="text-[13px] text-muted-foreground">{hint}</p>}
          </div>
          {aside}
        </div>
      )}
      {children}
    </div>
  );
}

/** The shared status vocabulary of every provider connection. */
export type ConnectionState = "connected" | "unverified" | "not_configured";

const STATE_LAMP: Record<ConnectionState, Lamp> = {
  connected: "success",
  unverified: "warning",
  not_configured: "off",
};

export function connectionLamp(state: ConnectionState | undefined): Lamp {
  return state ? STATE_LAMP[state] : "off";
}

/**
 * The top zone of a connection section: a lamp and what it reports, with the
 * actions that act on the saved credential beside it.
 */
export function ConnectionReadout({
  state,
  lamp,
  text,
  detail,
  actions,
}: {
  state?: ConnectionState;
  /** Overrides the state's lamp, for readouts that are not a verified connection. */
  lamp?: Lamp;
  text: string;
  detail?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="dash-zone flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <IndicatorLamp tone={lamp ?? connectionLamp(state)} />
        <div className="min-w-0">
          <p role="status" className="truncate text-[14px] font-medium text-foreground">{text}</p>
          {detail && <p className="truncate text-[12px] text-muted-foreground">{detail}</p>}
        </div>
      </div>
      {/* Nothing to test or clear before a credential is saved. */}
      {actions && state !== "not_configured" && <div className="flex flex-wrap items-center gap-1">{actions}</div>}
    </div>
  );
}

/** A native checkbox drawn as the instrument's slide switch; keeps its role and keyboard behavior. */
export function Switch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="g5-switch"
    />
  );
}
